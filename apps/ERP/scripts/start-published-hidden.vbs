Set shell = CreateObject("WScript.Shell")
shell.Environment("PROCESS")("ERP_URLS") = "http://localhost:5000;http://localhost:5173"
shell.Run """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\run-published.cmd" & """", 0, False
