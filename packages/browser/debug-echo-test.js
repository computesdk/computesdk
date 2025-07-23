// Debug the echo command issue
import { ShellParser } from './dist/index.js'
import { EchoCommand } from './dist/index.js'

const parser = new ShellParser()
const echo = new EchoCommand()

// Test the exact command from the failing test
const commandLine = 'echo "Line1\\\\nLine2\\\\r\\\\nLine3"'
console.log('Command line:', JSON.stringify(commandLine))

const parsed = parser.parse(commandLine)
console.log('Parsed:', JSON.stringify(parsed, null, 2))

if (parsed.commands.length > 0) {
  const cmd = parsed.commands[0]
  console.log('Command:', cmd.command)
  console.log('Args:', JSON.stringify(cmd.args))
  
  if (cmd.command === 'echo') {
    echo.execute(cmd.args, {}).then(result => {
      console.log('Result stdout:', JSON.stringify(result.stdout))
      console.log('Expected:', JSON.stringify('Line1\nLine2\r\nLine3\n'))
      console.log('Match?', result.stdout === 'Line1\nLine2\r\nLine3\n')
    })
  }
}