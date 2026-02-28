Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
ws.Run """C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"" app.py", 0, False
WScript.Sleep 1500
ws.Run "http://localhost:5000"
