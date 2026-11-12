@echo off
rem Fill in only the sites that still have no logo fingerprint, using a visible browser window (takes a few minutes).
call "%~dp0build-logo-hashes.cmd" --only-missing --headed
