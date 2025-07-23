import { Events, makeSchema, Schema, State } from '@livestore/livestore'

// Filesystem events
export const events = {
  // File operations
  fileCreated: Events.synced({
    name: 'v1.FileCreated',
    schema: Schema.Struct({
      path: Schema.String,
      content: Schema.String,
      mimeType: Schema.String.pipe(Schema.optional),
      size: Schema.Number,
      createdAt: Schema.Date,
    }),
  }),

  fileWritten: Events.synced({
    name: 'v1.FileWritten',
    schema: Schema.Struct({
      path: Schema.String,
      content: Schema.String,
      size: Schema.Number,
      modifiedAt: Schema.Date,
    }),
  }),

  fileDeleted: Events.synced({
    name: 'v1.FileDeleted',
    schema: Schema.Struct({
      path: Schema.String,
      deletedAt: Schema.Date,
    }),
  }),

  // Directory operations
  directoryCreated: Events.synced({
    name: 'v1.DirectoryCreated',
    schema: Schema.Struct({
      path: Schema.String,
      createdAt: Schema.Date,
    }),
  }),

  directoryDeleted: Events.synced({
    name: 'v1.DirectoryDeleted',
    schema: Schema.Struct({
      path: Schema.String,
      deletedAt: Schema.Date,
    }),
  }),

  // Command execution
  commandExecuted: Events.synced({
    name: 'v1.CommandExecuted',
    schema: Schema.Struct({
      command: Schema.String,
      cwd: Schema.String,
      exitCode: Schema.Number,
      stdout: Schema.String,
      stderr: Schema.String,
      executedAt: Schema.Date,
    }),
  }),
}

// Database tables
const filesTable = State.SQLite.table({
  name: 'files',
  columns: {
    path: State.SQLite.text({ primaryKey: true }),
    name: State.SQLite.text(),
    parentPath: State.SQLite.text(),
    content: State.SQLite.text({ default: '' }),
    mimeType: State.SQLite.text({ nullable: true }),
    size: State.SQLite.integer({ default: 0 }),
    isDirectory: State.SQLite.boolean({ default: false }),
    createdAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
    modifiedAt: State.SQLite.integer({ schema: Schema.DateFromNumber, nullable: true }),
    deletedAt: State.SQLite.integer({ schema: Schema.DateFromNumber, nullable: true }),
  },
})

const commandsTable = State.SQLite.table({
  name: 'commands',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    command: State.SQLite.text(),
    cwd: State.SQLite.text(),
    exitCode: State.SQLite.integer(),
    stdout: State.SQLite.text({ default: '' }),
    stderr: State.SQLite.text({ default: '' }),
    executedAt: State.SQLite.integer({ schema: Schema.DateFromNumber }),
  },
})

const tables = {
  files: filesTable,
  commands: commandsTable,
}

// Materializers - map events to database changes
export const materializers = State.SQLite.materializers(events, {
  'v1.FileCreated': ({ path, content, mimeType, size, createdAt }: any) => {
    const name = path.split('/').pop() || ''
    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/'
    
    return tables.files.insert({
      path,
      name,
      parentPath,
      content,
      mimeType,
      size,
      isDirectory: false,
      createdAt,
      modifiedAt: createdAt,
    })
  },

  'v1.FileWritten': ({ path, content, size, modifiedAt }: any) =>
    tables.files.update({ content, size, modifiedAt }).where({ path }),

  'v1.FileDeleted': ({ path, deletedAt }: any) =>
    tables.files.update({ deletedAt }).where({ path }),

  'v1.DirectoryCreated': ({ path, createdAt }: any) => {
    const name = path.split('/').pop() || ''
    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/'
    
    return tables.files.insert({
      path,
      name,
      parentPath,
      content: '',
      size: 0,
      isDirectory: true,
      createdAt,
      modifiedAt: createdAt,
    })
  },

  'v1.DirectoryDeleted': ({ path, deletedAt }: any) =>
    tables.files.update({ deletedAt }).where({ path }),

  'v1.CommandExecuted': ({ command, cwd, exitCode, stdout, stderr, executedAt }: any) =>
    tables.commands.insert({
      id: `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      command,
      cwd,
      exitCode,
      stdout,
      stderr,
      executedAt,
    }),
})

// Create the state
const state = State.SQLite.makeState({ tables, materializers })

// Complete schema export
export const schema = makeSchema({ events, state })