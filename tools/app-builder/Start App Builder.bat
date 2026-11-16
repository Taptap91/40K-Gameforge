@echo off
python "%~dp0app_builder.py" %* || py "%~dp0app_builder.py" %*
pause
