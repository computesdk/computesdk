# compute

## Overview

### ComputeSDK API Key
1) Visit https://console.computesdk.com/register to create an account and get your ComputeSDK API key.
2) Next create a .env file in the root of your project and add your API key (this is where you will store your API keys for each of your providers):
```bash
COMPUTESDK_API_KEY=your_api_key_here
```

### Provider-specific env variables
- wondering which env variables you need from your provider? Supported providers & details found here <link>/providers</link>
```bash
PROVIDER_API_KEY=your_provider_api_key_here
```

### Install computesdk
```bash
npm install computesdk
```

### Creating a sandbox

- [compute.sandbox](./compute.sandbox)


### Sandbox (interface)
- [Sandbox](./sandbox)


### Events
- [compute.events](./compute.events)


### Templates
- [compute.templates](./compute.templates)