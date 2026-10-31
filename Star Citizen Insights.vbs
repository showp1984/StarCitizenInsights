' Starts Star Citizen Insights without a console window and opens it in its own app window.
' The background server quits on its own about two minutes after you close the window.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir
shell.Run "node """ & appDir & "\src\server.js"" --open --exit-when-idle", 0, False
