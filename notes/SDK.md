# SDK

```js
function sdk() {
  const baseOperations = {
    create: async (params) => {
      return;
    },
    update: async (id, updates) => {
      return;
    },
    delete: async (id) => {
      return;
    },
    list: async (filters) => {
      return;
    },
    retrieve: async (id) => {
      return;
    },
    clone: async (id) => {
      return;
    }
  }


  return {
    secrets: {
      // TODO relate to compute and groups
      ...baseOperations
    },
    filesystems: {
      // TODO relate to compute and groups
      ...baseOperations
    },
    compute: {
      // TODO relate to groups
      ...baseOperations
    },
    groups: {
      // TODO relate to compute, filesystems, secrets, groups(?)
      ...baseOperations
    }
  }
}

const dev = await sdk().groups.create()
const prod = await group1.clone()
```