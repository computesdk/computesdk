import { makeWorker } from '@livestore/adapter-web/worker'
import { schema } from './schema.js'

// Create the LiveStore worker
makeWorker({ schema })