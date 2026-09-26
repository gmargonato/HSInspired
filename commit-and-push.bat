@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem One-click commit and push for HSInspired.
rem Use --no-pause when calling this script from another terminal or script.

set "EXIT_CODE=0"
set "PUSHD_OK=0"
set "PAUSE_AT_END=1"
if /I "%~1"=="--no-pause" set "PAUSE_AT_END=0"

pushd "%~dp0" >nul 2>&1
if errorlevel 1 goto :error_directory
set "PUSHD_OK=1"

where git >nul 2>&1
if errorlevel 1 goto :error_git
where gh >nul 2>&1
if errorlevel 1 goto :error_gh

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto :error_repository

set "CURRENT_BRANCH="
for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%B"
if /I not "%CURRENT_BRANCH%"=="main" goto :error_branch

set "REMOTE_URL="
for /f "delims=" %%R in ('git config --get remote.origin.url 2^>nul') do set "REMOTE_URL=%%R"
if not defined REMOTE_URL goto :error_remote
if /I "%REMOTE_URL%"=="https://github.com/gmargonato/HSInspired.git" goto :remote_valid
if /I "%REMOTE_URL%"=="https://github.com/gmargonato/HSInspired" goto :remote_valid
if /I "%REMOTE_URL%"=="git@github.com:gmargonato/HSInspired.git" goto :remote_valid
if /I "%REMOTE_URL%"=="git@github.com:gmargonato/HSInspired" goto :remote_valid
if /I "%REMOTE_URL%"=="ssh://git@github.com/gmargonato/HSInspired.git" goto :remote_valid
if /I "%REMOTE_URL%"=="ssh://git@github.com/gmargonato/HSInspired" goto :remote_valid
goto :error_remote

:remote_valid
set "GIT_EMAIL="
for /f "delims=" %%E in ('git config --get user.email 2^>nul') do set "GIT_EMAIL=%%E"
if /I not "%GIT_EMAIL%"=="gabriel-merida@hotmail.com" goto :error_identity

set "LOGIN_ATTEMPTED=0"
echo Selecting GitHub account gmargonato...
gh auth switch --hostname github.com --user gmargonato >nul 2>&1
if errorlevel 1 goto :run_auth_login
goto :verify_auth

:run_auth_login
if "%LOGIN_ATTEMPTED%"=="1" goto :error_auth
set "LOGIN_ATTEMPTED=1"
echo GitHub login is required. Sign in to the browser as gmargonato.
gh auth login --hostname github.com --git-protocol https --web --skip-ssh-key
if errorlevel 1 goto :error_auth
gh auth switch --hostname github.com --user gmargonato >nul 2>&1
if errorlevel 1 goto :error_auth

:verify_auth
set "AUTH_USER="
for /f "delims=" %%U in ('gh api user --hostname github.com --jq .login 2^>nul') do if not defined AUTH_USER set "AUTH_USER=%%U"
if not defined AUTH_USER goto :run_auth_login
if /I not "%AUTH_USER%"=="gmargonato" goto :error_account

set "PUSH_PERMISSION="
for /f "delims=" %%P in ('gh api repos/gmargonato/HSInspired --hostname github.com --jq .permissions.push 2^>nul') do if not defined PUSH_PERMISSION set "PUSH_PERMISSION=%%P"
if /I not "%PUSH_PERMISSION%"=="true" goto :error_permission

rem Make HTTPS pushes use the same authenticated GitHub CLI account that was checked above.
gh auth setup-git --hostname github.com >nul 2>&1
if errorlevel 1 goto :error_setup_git

echo.
echo Repository: %CD%
echo Remote:     %REMOTE_URL%
echo Branch:     %CURRENT_BRANCH%
echo GitHub:     %AUTH_USER%
echo.
git status --short --branch

set "HAS_CHANGES="
for /f "delims=" %%S in ('git status --porcelain 2^>nul') do set "HAS_CHANGES=1"
if not defined HAS_CHANGES goto :nothing_to_commit

git add -A
if errorlevel 1 goto :error_stage

for /f "delims=" %%T in ('powershell.exe -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "COMMIT_TIMESTAMP=%%T"
if not defined COMMIT_TIMESTAMP goto :error_timestamp
set "COMMIT_MESSAGE=Work done on %COMMIT_TIMESTAMP%"

echo.
echo Creating commit: %COMMIT_MESSAGE%
git commit -m "%COMMIT_MESSAGE%"
if errorlevel 1 goto :error_commit

echo.
echo Pushing to origin/main...
git push origin main
if errorlevel 1 goto :error_push

set "COMMIT_HASH="
for /f "delims=" %%H in ('git rev-parse --short HEAD 2^>nul') do set "COMMIT_HASH=%%H"
echo.
echo Completed successfully: %COMMIT_HASH%
goto :finish

:nothing_to_commit
echo.
echo No changes to commit. Nothing was pushed.
goto :finish

:error_directory
echo ERROR: Could not open the repository directory.
set "EXIT_CODE=1"
goto :finish

:error_git
echo ERROR: Git was not found on PATH.
set "EXIT_CODE=1"
goto :finish

:error_gh
echo ERROR: GitHub CLI ^(gh^) was not found on PATH.
set "EXIT_CODE=1"
goto :finish

:error_repository
echo ERROR: This script is not inside a Git working tree.
set "EXIT_CODE=1"
goto :finish

:error_branch
echo ERROR: Expected branch main, found "%CURRENT_BRANCH%".
set "EXIT_CODE=1"
goto :finish

:error_remote
echo ERROR: origin is not the expected gmargonato/HSInspired repository.
echo        Current origin: %REMOTE_URL%
set "EXIT_CODE=1"
goto :finish

:error_identity
echo ERROR: Git author email must be gabriel-merida@hotmail.com.
echo        Current email: %GIT_EMAIL%
set "EXIT_CODE=1"
goto :finish

:error_auth
echo ERROR: Could not authenticate as gmargonato.
echo        Complete the browser login with the gmargonato account and try again.
set "EXIT_CODE=1"
goto :finish

:error_account
echo ERROR: The active GitHub account is "%AUTH_USER%", not gmargonato.
echo        Switch with: gh auth switch -u gmargonato
echo        If needed, re-authenticate with: gh auth login -h github.com
set "EXIT_CODE=1"
goto :finish

:error_permission
echo ERROR: gmargonato does not have verified push access to gmargonato/HSInspired.
set "EXIT_CODE=1"
goto :finish

:error_setup_git
echo ERROR: GitHub CLI could not configure the Git credential helper.
set "EXIT_CODE=1"
goto :finish

:error_stage
echo ERROR: Git could not stage the current changes.
set "EXIT_CODE=1"
goto :finish

:error_timestamp
echo ERROR: Could not create a timestamp for the commit message.
set "EXIT_CODE=1"
goto :finish

:error_commit
echo ERROR: Commit failed. Review the output above; no push was attempted.
set "EXIT_CODE=1"
goto :finish

:error_push
echo ERROR: Push failed. The local commit remains intact; no pull or reset was performed.
set "EXIT_CODE=1"
goto :finish

:finish
if "%PUSHD_OK%"=="1" popd >nul 2>&1
if "%PAUSE_AT_END%"=="1" pause
exit /b %EXIT_CODE%
