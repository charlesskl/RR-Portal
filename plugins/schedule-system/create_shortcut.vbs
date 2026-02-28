Set ws = CreateObject("WScript.Shell")
desktop = ws.SpecialFolders("Desktop")
' 排期系统-测试版 -> 排期测试版.lnk
lnkName = ChrW(25490) & ChrW(26399) & ChrW(27979) & ChrW(35797) & ChrW(29256) & ".lnk"
' 排期系统-测试版
folderName = ChrW(25490) & ChrW(26399) & ChrW(31995) & ChrW(32479) & "-" & ChrW(27979) & ChrW(35797) & ChrW(29256)
' 启动系统.bat
batName = ChrW(21551) & ChrW(21160) & ChrW(31995) & ChrW(32479) & ".bat"

Set sc = ws.CreateShortcut(desktop & "\" & lnkName)
sc.TargetPath = desktop & "\" & folderName & "\" & batName
sc.WorkingDirectory = desktop & "\" & folderName
sc.IconLocation = "C:\Windows\System32\shell32.dll,2"
sc.WindowStyle = 7
sc.Save
WScript.Echo "OK"
