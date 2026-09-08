#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <arpa/inet.h>
#import <netinet/in.h>
#import <sys/socket.h>
#import <unistd.h>

static const uint16_t ToyQMSPort = 43127;

@interface ToyQMSStaticServer : NSObject
@property(nonatomic, strong) NSURL *webRoot;
@property(nonatomic, assign) int serverSocket;
- (instancetype)initWithWebRoot:(NSURL *)webRoot;
- (BOOL)start:(NSError **)error;
- (void)stop;
@end

@implementation ToyQMSStaticServer
- (instancetype)initWithWebRoot:(NSURL *)webRoot {
    if ((self = [super init])) {
        _webRoot = webRoot.standardizedURL;
        _serverSocket = -1;
    }
    return self;
}

- (BOOL)start:(NSError **)error {
    self.serverSocket = socket(AF_INET, SOCK_STREAM, 0);
    if (self.serverSocket < 0) return [self failWithErrno:error];
    int enabled = 1;
    setsockopt(self.serverSocket, SOL_SOCKET, SO_REUSEADDR, &enabled, sizeof(enabled));
    setsockopt(self.serverSocket, SOL_SOCKET, SO_NOSIGPIPE, &enabled, sizeof(enabled));
    struct sockaddr_in address = {0};
    address.sin_len = sizeof(address);
    address.sin_family = AF_INET;
    address.sin_port = htons(ToyQMSPort);
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(self.serverSocket, (struct sockaddr *)&address, sizeof(address)) < 0 || listen(self.serverSocket, 16) < 0) {
        [self failWithErrno:error];
        [self stop];
        return NO;
    }
    __weak typeof(self) weakSelf = self;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        while (weakSelf && weakSelf.serverSocket >= 0) {
            int client = accept(weakSelf.serverSocket, NULL, NULL);
            if (client < 0) continue;
            setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &enabled, sizeof(enabled));
            dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ [weakSelf handleClient:client]; });
        }
    });
    return YES;
}

- (BOOL)failWithErrno:(NSError **)error {
    if (error) *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil];
    return NO;
}

- (void)stop {
    if (self.serverSocket >= 0) {
        close(self.serverSocket);
        self.serverSocket = -1;
    }
}

- (void)handleClient:(int)client {
    char buffer[65536];
    ssize_t count = recv(client, buffer, sizeof(buffer) - 1, 0);
    if (count <= 0) { close(client); return; }
    buffer[count] = '\0';
    char method[16] = {0};
    char rawPath[8192] = {0};
    sscanf(buffer, "%15s %8191s", method, rawPath);
    if (strcmp(method, "GET") != 0) {
        [self sendStatus:@"405 Method Not Allowed" type:@"text/plain" body:[NSData data] client:client];
        return;
    }
    NSString *target = [NSString stringWithUTF8String:rawPath] ?: @"/";
    target = [[target componentsSeparatedByString:@"?"] firstObject].stringByRemovingPercentEncoding ?: target;
    NSURL *fileURL = [self fileURLForTarget:target];
    if (!fileURL) {
        [self sendStatus:@"403 Forbidden" type:@"text/plain; charset=utf-8" body:[@"禁止访问" dataUsingEncoding:NSUTF8StringEncoding] client:client];
        return;
    }
    NSData *body = [NSData dataWithContentsOfURL:fileURL];
    if (!body) {
        body = [NSData dataWithContentsOfURL:[self.webRoot URLByAppendingPathComponent:@"404.html"]] ?: [@"页面不存在" dataUsingEncoding:NSUTF8StringEncoding];
        [self sendStatus:@"404 Not Found" type:@"text/html; charset=utf-8" body:body client:client];
        return;
    }
    [self sendStatus:@"200 OK" type:[self mimeType:fileURL.pathExtension] body:body client:client];
}

- (NSURL *)fileURLForTarget:(NSString *)target {
    NSString *relative = [target stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/"]];
    if (relative.length == 0) relative = @"index.html";
    if ([target hasSuffix:@"/"] && ![relative isEqualToString:@"index.html"]) relative = [relative stringByAppendingPathComponent:@"index.html"];
    if (relative.pathExtension.length == 0 && ![relative hasSuffix:@"index.html"]) relative = [relative stringByAppendingPathComponent:@"index.html"];
    NSURL *candidate = [[self.webRoot URLByAppendingPathComponent:relative] standardizedURL];
    NSString *rootPath = self.webRoot.path;
    if (![candidate.path isEqualToString:rootPath] && ![candidate.path hasPrefix:[rootPath stringByAppendingString:@"/"]]) return nil;
    return candidate;
}

- (NSString *)mimeType:(NSString *)extension {
    NSDictionary *types = @{@"html":@"text/html; charset=utf-8",@"css":@"text/css; charset=utf-8",@"js":@"application/javascript; charset=utf-8",@"mjs":@"application/javascript; charset=utf-8",@"json":@"application/json; charset=utf-8",@"map":@"application/json; charset=utf-8",@"svg":@"image/svg+xml",@"png":@"image/png",@"jpg":@"image/jpeg",@"jpeg":@"image/jpeg",@"gif":@"image/gif",@"webp":@"image/webp",@"ico":@"image/x-icon",@"woff":@"font/woff",@"woff2":@"font/woff2"};
    return types[extension.lowercaseString] ?: @"application/octet-stream";
}

- (void)sendStatus:(NSString *)status type:(NSString *)type body:(NSData *)body client:(int)client {
    NSString *header = [NSString stringWithFormat:@"HTTP/1.1 %@\r\nContent-Type: %@\r\nContent-Length: %lu\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n", status, type, (unsigned long)body.length];
    NSMutableData *response = [[header dataUsingEncoding:NSUTF8StringEncoding] mutableCopy];
    [response appendData:body];
    const uint8_t *bytes = response.bytes;
    NSUInteger sent = 0;
    while (sent < response.length) {
        ssize_t amount = send(client, bytes + sent, response.length - sent, 0);
        if (amount <= 0) break;
        sent += (NSUInteger)amount;
    }
    close(client);
}
@end

@interface ToyQMSAppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) ToyQMSStaticServer *server;
@end

@implementation ToyQMSAppDelegate
- (void)installMainMenu {
    NSMenu *mainMenu = [NSMenu new];

    NSMenuItem *applicationMenuItem = [NSMenuItem new];
    [mainMenu addItem:applicationMenuItem];
    NSMenu *applicationMenu = [NSMenu new];
    [applicationMenu addItemWithTitle:@"退出 ToyQMS" action:@selector(terminate:) keyEquivalent:@"q"];
    applicationMenuItem.submenu = applicationMenu;

    NSMenuItem *editMenuItem = [[NSMenuItem alloc] initWithTitle:@"编辑" action:nil keyEquivalent:@""];
    [mainMenu addItem:editMenuItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"编辑"];
    [editMenu addItemWithTitle:@"撤销" action:@selector(undo:) keyEquivalent:@"z"];
    NSMenuItem *redoItem = [editMenu addItemWithTitle:@"重做" action:@selector(redo:) keyEquivalent:@"Z"];
    redoItem.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    [editMenu addItem:NSMenuItem.separatorItem];
    [editMenu addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
    editMenuItem.submenu = editMenu;

    NSApp.mainMenu = mainMenu;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self installMainMenu];
    NSURL *webRoot = [NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"web"];
    self.server = [[ToyQMSStaticServer alloc] initWithWebRoot:webRoot];
    NSError *error = nil;
    if (![self.server start:&error]) {
        [self showFatal:[NSString stringWithFormat:@"ToyQMS 本地服务无法启动。请确认没有同时打开另一个 ToyQMS。\n\n%@", error.localizedDescription]];
        return;
    }
    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    configuration.websiteDataStore = WKWebsiteDataStore.defaultDataStore;
    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
    self.webView.navigationDelegate = self;
    self.webView.UIDelegate = self;
    self.webView.allowsBackForwardNavigationGestures = YES;
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1440, 900) styleMask:(NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable) backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"ToyQMS — 玩具质量管理系统";
    self.window.minSize = NSMakeSize(1024, 700);
    self.window.contentView = self.webView;
    [self.window center];
    [self.window setFrameAutosaveName:@"ToyQMS.MainWindow"];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    NSURL *startURL = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%u/dashboard/", ToyQMSPort]];
    [self.webView loadRequest:[NSURLRequest requestWithURL:startURL cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:30]];
}

- (void)applicationWillTerminate:(NSNotification *)notification { [self.server stop]; }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action preferences:(WKWebpagePreferences *)preferences decisionHandler:(void (^)(WKNavigationActionPolicy, WKWebpagePreferences *))decisionHandler API_AVAILABLE(macos(10.15)) {
    if (action.shouldPerformDownload) { decisionHandler(WKNavigationActionPolicyDownload, preferences); return; }
    NSURL *url = action.request.URL;
    if (url.host && ![url.host isEqualToString:@"127.0.0.1"]) {
        [NSWorkspace.sharedWorkspace openURL:url];
        decisionHandler(WKNavigationActionPolicyCancel, preferences);
        return;
    }
    decisionHandler(WKNavigationActionPolicyAllow, preferences);
}

- (void)webView:(WKWebView *)webView navigationAction:(WKNavigationAction *)navigationAction didBecomeDownload:(WKDownload *)download API_AVAILABLE(macos(11.0)) { download.delegate = self; }

- (void)webView:(WKWebView *)webView runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> * _Nullable URLs))completionHandler {
    NSOpenPanel *panel = NSOpenPanel.openPanel;
    panel.canChooseFiles = YES;
    panel.canChooseDirectories = parameters.allowsDirectories;
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
        completionHandler(result == NSModalResponseOK ? panel.URLs : nil);
    }];
}

- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"ToyQMS";
    alert.informativeText = message ?: @"";
    [alert addButtonWithTitle:@"确定"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(__unused NSModalResponse response) {
        completionHandler();
    }];
}

- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL result))completionHandler {
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"请确认";
    alert.informativeText = message ?: @"";
    [alert addButtonWithTitle:@"确认"];
    [alert addButtonWithTitle:@"取消"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response) {
        completionHandler(response == NSAlertFirstButtonReturn);
    }];
}

- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)suggestedFilename completionHandler:(void (^)(NSURL * _Nullable))completionHandler API_AVAILABLE(macos(11.0)) {
    NSSavePanel *panel = NSSavePanel.savePanel;
    panel.nameFieldStringValue = suggestedFilename;
    panel.canCreateDirectories = YES;
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) { completionHandler(result == NSModalResponseOK ? panel.URL : nil); }];
}

- (void)downloadDidFinish:(WKDownload *)download API_AVAILABLE(macos(11.0)) {}
- (void)download:(WKDownload *)download didFailWithError:(NSError *)error resumeData:(NSData *)resumeData API_AVAILABLE(macos(11.0)) {
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"文件导出失败";
    alert.informativeText = error.localizedDescription;
    [alert runModal];
}

- (void)showFatal:(NSString *)message {
    NSAlert *alert = [NSAlert new];
    alert.alertStyle = NSAlertStyleCritical;
    alert.messageText = @"无法启动 ToyQMS";
    alert.informativeText = message;
    [alert runModal];
    [NSApp terminate:nil];
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = NSApplication.sharedApplication;
        ToyQMSAppDelegate *delegate = [ToyQMSAppDelegate new];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}
