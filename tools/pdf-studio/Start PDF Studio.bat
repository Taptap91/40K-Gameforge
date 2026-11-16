@echo off
set PY=python
where python >nul 2>nul || set PY=py
%PY% -c "import pypdf" 2>nul || (echo Installing the PDF library, one moment... & %PY% -m pip install pypdf)
set PYW=pythonw
where pythonw >nul 2>nul || set PYW=pyw
start "" %PYW% "%~dp0pdf_studio.py"
