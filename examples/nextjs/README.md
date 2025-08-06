# ComputeSDK + Next.js Example

This example demonstrates how to integrate ComputeSDK with Next.js for server-side code execution using App Router.

## Features

- **API Route**: `/api/execute` endpoint for code execution
- **Auto-Detection**: Automatically selects the best available provider
- **Multiple Runtimes**: Support for Python and JavaScript execution
- **Error Handling**: Comprehensive error handling and user feedback
- **TypeScript**: Full type safety throughout the application

## Setup

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` and add your provider credentials. You need at least one provider configured:
   
   - **E2B**: Get your API key from [e2b.dev](https://e2b.dev)
   - **Vercel**: Get your token from [vercel.com/account/tokens](https://vercel.com/account/tokens)
   - **Daytona**: Get your API key from your Daytona instance

3. **Run the development server**:
   ```bash
   pnpm dev
   ```

4. **Open your browser** and navigate to [http://localhost:3000](http://localhost:3000)

## Usage

1. Select your preferred runtime (Python or JavaScript)
2. Enter your code in the text area
3. Click "Execute Code" to run it in a secure sandbox
4. View the results, including output, errors, execution time, and provider used

## API Reference

### POST /api/execute

Execute code in a secure sandbox environment.

**Request Body:**
```json
{
  "code": "print('Hello, World!')",
  "runtime": "python"
}
```

**Response (Success):**
```json
{
  "success": true,
  "result": {
    "output": "Hello, World!\n",
    "error": null,
    "executionTime": 150,
    "provider": "e2b"
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Code is required and must be a string"
}
```

## Provider Configuration

ComputeSDK will automatically detect and use the first available provider based on your environment variables:

1. **E2B** - Requires `E2B_API_KEY`
2. **Vercel** - Requires `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`
3. **Daytona** - Requires `DAYTONA_API_KEY`

## Deployment

This example can be deployed to any platform that supports Next.js:

- **Vercel**: `vercel deploy`
- **Netlify**: Connect your Git repository
- **Railway**: `railway deploy`
- **Docker**: Use the included Dockerfile

Make sure to configure your environment variables in your deployment platform.

## Security Considerations

- All code execution happens in isolated sandbox environments
- Environment variables are only accessible on the server side
- Input validation is performed on all API requests
- Consider implementing rate limiting for production use

## Learn More

- [ComputeSDK Documentation](https://github.com/computesdk/computesdk)
- [Next.js Documentation](https://nextjs.org/docs)
- [E2B Documentation](https://e2b.dev/docs)
- [Vercel Sandbox Documentation](https://vercel.com/docs/functions/sandbox)