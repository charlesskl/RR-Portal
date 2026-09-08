#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) return 1;
        const size_t size = 1024;
        CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
        CGContextRef context = CGBitmapContextCreate(NULL, size, size, 8, size * 4, colorSpace, kCGImageAlphaPremultipliedLast);
        CGContextSetRGBFillColor(context, 0.075, 0.075, 0.075, 1);
        CGPathRef background = CGPathCreateWithRoundedRect(CGRectMake(52, 52, 920, 920), 210, 210, NULL);
        CGContextAddPath(context, background); CGContextFillPath(context);
        CGContextSetRGBStrokeColor(context, 0.953, 0.42, 0.129, 1); CGContextSetLineWidth(context, 22);
        CGPathRef border = CGPathCreateWithRoundedRect(CGRectMake(118, 118, 788, 788), 158, 158, NULL);
        CGContextAddPath(context, border); CGContextStrokePath(context);
        CGContextSetRGBFillColor(context, 1, 1, 1, 1);
        CGContextFillRect(context, CGRectMake(257, 608, 510, 94));
        CGContextFillRect(context, CGRectMake(458, 266, 108, 436));
        CGContextSetRGBFillColor(context, 0.953, 0.42, 0.129, 1);
        CGContextFillEllipseInRect(context, CGRectMake(615, 229, 210, 210));
        CGContextSetRGBStrokeColor(context, 1, 1, 1, 1); CGContextSetLineWidth(context, 30); CGContextSetLineCap(context, kCGLineCapRound); CGContextSetLineJoin(context, kCGLineJoinRound);
        CGContextMoveToPoint(context, 664, 334); CGContextAddLineToPoint(context, 702, 296); CGContextAddLineToPoint(context, 780, 384); CGContextStrokePath(context);
        CGImageRef image = CGBitmapContextCreateImage(context);
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
        CGImageDestinationRef destination = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, (__bridge CFStringRef)UTTypePNG.identifier, 1, NULL);
        CGImageDestinationAddImage(destination, image, NULL);
        BOOL ok = CGImageDestinationFinalize(destination);
        CFRelease(destination); CGImageRelease(image); CGPathRelease(background); CGPathRelease(border); CGContextRelease(context); CGColorSpaceRelease(colorSpace);
        return ok ? 0 : 2;
    }
}
