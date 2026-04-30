Set shell = CreateObject("WScript.Shell")
shell.Run """" & Replace(WScript.ScriptFullName, "run-tauri-dev.vbs", "run-tauri-dev-inner.cmd") & """", 0, False
Set shell = Nothing
