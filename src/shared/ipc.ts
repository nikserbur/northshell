/** IPC channel names shared by main, preload and renderer. */
export const IPC = {
  sessionsList: 'sessions:list',
  sessionsSave: 'sessions:save',
  sessionsRemove: 'sessions:remove',
  sessionsDuplicate: 'sessions:duplicate',
  sessionsImport: 'sessions:import-ssh-config',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  termOpen: 'term:open',
  termWrite: 'term:write',
  termResize: 'term:resize',
  termClose: 'term:close',
  termData: 'term:data',
  termStatus: 'term:status',

  sftpList: 'sftp:list',
  sftpHome: 'sftp:home',
  sftpMkdir: 'sftp:mkdir',
  sftpRename: 'sftp:rename',
  sftpRemove: 'sftp:remove',
  sftpUpload: 'sftp:upload',
  sftpUploadDialog: 'sftp:upload-dialog',
  sftpDownload: 'sftp:download',
  sftpTransfer: 'sftp:transfer',
  sftpReadFile: 'sftp:read-file',
  sftpWriteFile: 'sftp:write-file',
  sftpCreateFile: 'sftp:create-file',
  sftpChmod: 'sftp:chmod',
  sftpSearch: 'sftp:search',

  monitorSnapshot: 'monitor:snapshot',
  monitorLocal: 'monitor:local',

  promptRequest: 'prompt:request',
  promptRespond: 'prompt:respond',
  promptCancel: 'prompt:cancel',

  appOpenExternal: 'app:open-external',
  appShowInFolder: 'app:show-in-folder',
  appPickFile: 'app:pick-file',
  appPickDir: 'app:pick-dir',
  appInfo: 'app:info',
  menuAction: 'menu:action'
} as const
