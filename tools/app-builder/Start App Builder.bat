@echo off
set PYW=pythonw
where pythonw >nul 2>nul || set PYW=pyw
start "" %PYW% "%~dp0app_builder.py" %*
