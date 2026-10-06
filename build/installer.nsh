; Dungeon Zen installs for the current user only: no administrator rights needed.
; (electron-builder calls this macro to choose the install mode.)
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
