' Starts 3DPrintCollectors without leaving a console window open.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & shell.CurrentDirectory & "\start.cmd""", 0, False
