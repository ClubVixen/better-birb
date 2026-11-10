!include "FileFunc.nsh"

!ifdef BUILD_UNINSTALLER
  Var aiTaggerParameters
  Var aiTaggerOption
  Var aiTaggerStashedOnUninstall
!else
  Var aiTaggerPreviousInstall
!endif

# Keep the backup next to the installation, on the same volume and outside
# the tree that older uninstallers delete. A later install can recover it.
!macro StashAiTagger ROOT
  ${If} ${FileExists} "${ROOT}\resources\AiTagger\*.*"
    ClearErrors
    Rename "${ROOT}\resources\AiTagger" "${ROOT}.AiTagger-backup"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Could not safeguard AiTagger. Close Better Birb and any Python processes using it. Check whether this backup already exists:$\r$\n${ROOT}.AiTagger-backup" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro RestoreAiTagger ROOT
  ${If} ${FileExists} "${ROOT}.AiTagger-backup\*.*"
    CreateDirectory "${ROOT}\resources"
    ClearErrors
    Rename "${ROOT}.AiTagger-backup" "${ROOT}\resources\AiTagger"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Could not restore AiTagger. Your files are still saved at:$\r$\n${ROOT}.AiTagger-backup" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  # Protect existing data before electron-builder runs the legacy uninstaller.
  ReadRegStr $aiTaggerPreviousInstall SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $aiTaggerPreviousInstall == ""
    StrCpy $aiTaggerPreviousInstall $INSTDIR
  ${EndIf}
  !insertmacro StashAiTagger "$aiTaggerPreviousInstall"
!macroend

!macro customInstall
  ${If} $aiTaggerPreviousInstall != $INSTDIR
    !insertmacro RestoreAiTagger "$aiTaggerPreviousInstall"
  ${EndIf}

  ${If} ${FileExists} "$INSTDIR.AiTagger-backup\*.*"
    # These are the only bundled AiTagger files. Use a nonrecursive removal so
    # any extra files at the destination prevent replacing the directory.
    ${IfNot} ${FileExists} "$INSTDIR.AiTagger-backup\tagger.py"
      CopyFiles /SILENT "$INSTDIR\resources\AiTagger\tagger.py" "$INSTDIR.AiTagger-backup"
    ${EndIf}
    ${IfNot} ${FileExists} "$INSTDIR.AiTagger-backup\requirements.txt"
      CopyFiles /SILENT "$INSTDIR\resources\AiTagger\requirements.txt" "$INSTDIR.AiTagger-backup"
    ${EndIf}
    Delete "$INSTDIR\resources\AiTagger\tagger.py"
    Delete "$INSTDIR\resources\AiTagger\requirements.txt"
    RMDir "$INSTDIR\resources\AiTagger"
    !insertmacro RestoreAiTagger "$INSTDIR"
  ${EndIf}
!macroend

!macro customUnInit
  ${If} ${FileExists} "$INSTDIR\resources\AiTagger\*.*"
    ${GetParameters} $aiTaggerParameters
    ${GetOptions} $aiTaggerParameters "--remove-ai-tagger" $aiTaggerOption
    ${IfNot} ${Errors}
      Goto aiTaggerUninstallDone
    ${EndIf}

    # One-click NSIS switches to silent mode after its confirmation. Check
    # the original command line so interactive uninstalls still get a choice.
    ${GetOptionsS} $aiTaggerParameters "/S" $aiTaggerOption
    ${If} ${Errors}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Keep the AiTagger folder for your next Better Birb install? This keeps the downloaded model and Python environment in resources\AiTagger." IDNO aiTaggerUninstallDone
    ${EndIf}
    !insertmacro StashAiTagger "$INSTDIR"
    StrCpy $aiTaggerStashedOnUninstall "1"
  ${EndIf}
  aiTaggerUninstallDone:
!macroend

!macro customUnInstall
  ${If} $aiTaggerStashedOnUninstall == "1"
    !insertmacro RestoreAiTagger "$INSTDIR"
  ${EndIf}
!macroend
