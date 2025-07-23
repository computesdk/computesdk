import { Command } from 'commander'
import pc from 'picocolors'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Read package.json to get version
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
)

const program = new Command()

program
  .name('create-compute')
  .description('Create ComputeSDK projects with a single command')
  .version(packageJson.version)
  .argument('[project-name]', 'Name of your project')
  .option('-t, --template <template>', 'Template to use', 'basic')
  .action((projectName, options) => {
    console.log(pc.bold(pc.cyan('\n📦 Welcome to create-compute!\n')))
    
    if (projectName) {
      console.log(`Creating a new ComputeSDK project: ${pc.green(projectName)}`)
      console.log(`Using template: ${pc.yellow(options.template)}`)
    } else {
      console.log('No project name provided. Run with a project name:')
      console.log(pc.gray('  npx create-compute my-app'))
    }
    
    console.log(pc.gray('\nThis CLI is under development. Check back soon!'))
  })

program.parse()