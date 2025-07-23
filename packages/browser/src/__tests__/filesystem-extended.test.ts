import { describe, it, expect, beforeEach } from 'vitest'
import { TestFileSystem } from './test-filesystem.js'

describe('Filesystem Extended Tests', () => {
  let filesystem: TestFileSystem

  beforeEach(() => {
    filesystem = new TestFileSystem()
  })

  describe('File Operations', () => {
    it('should write and read text files', async () => {
      const content = 'Hello, World!'
      const path = '/test.txt'

      await filesystem.writeFile(path, content)
      const readContent = await filesystem.readFile(path)

      expect(readContent).toBe(content)
    })

    it('should write and read binary-like content', async () => {
      const content = 'Binary content: \x00\x01\x02\xFF'
      const path = '/binary.dat'

      await filesystem.writeFile(path, content)
      const readContent = await filesystem.readFile(path)

      expect(readContent).toBe(content)
    })

    it('should handle empty files', async () => {
      const path = '/empty.txt'

      await filesystem.writeFile(path, '')
      const content = await filesystem.readFile(path)

      expect(content).toBe('')
    })

    it('should handle large files', async () => {
      const largeContent = 'A'.repeat(10000)
      const path = '/large.txt'

      await filesystem.writeFile(path, largeContent)
      const readContent = await filesystem.readFile(path)

      expect(readContent).toBe(largeContent)
      expect(readContent.length).toBe(10000)
    })

    it('should overwrite existing files', async () => {
      const path = '/overwrite.txt'

      await filesystem.writeFile(path, 'Original content')
      await filesystem.writeFile(path, 'New content')
      
      const content = await filesystem.readFile(path)
      expect(content).toBe('New content')
    })

    it('should handle special characters in content', async () => {
      const specialContent = 'Special chars: áéíóú ñ 中文 🚀 \n\t\r'
      const path = '/special.txt'

      await filesystem.writeFile(path, specialContent)
      const readContent = await filesystem.readFile(path)

      expect(readContent).toBe(specialContent)
    })

    it('should throw error when reading non-existent file', async () => {
      await expect(filesystem.readFile('/nonexistent.txt'))
        .rejects.toThrow('File not found: /nonexistent.txt')
    })

    it('should handle files with same name in different directories', async () => {
      await filesystem.mkdir('/dir1')
      await filesystem.mkdir('/dir2')
      
      await filesystem.writeFile('/dir1/same.txt', 'Content 1')
      await filesystem.writeFile('/dir2/same.txt', 'Content 2')

      const content1 = await filesystem.readFile('/dir1/same.txt')
      const content2 = await filesystem.readFile('/dir2/same.txt')

      expect(content1).toBe('Content 1')
      expect(content2).toBe('Content 2')
    })
  })

  describe('Directory Operations', () => {
    it('should create and list directories', async () => {
      const dirPath = '/testdir'

      await filesystem.mkdir(dirPath)
      const exists = await filesystem.exists(dirPath)

      expect(exists).toBe(true)
    })

    it('should create nested directories', async () => {
      await filesystem.mkdir('/level1')
      await filesystem.mkdir('/level1/level2')
      await filesystem.mkdir('/level1/level2/level3')

      expect(await filesystem.exists('/level1')).toBe(true)
      expect(await filesystem.exists('/level1/level2')).toBe(true)
      expect(await filesystem.exists('/level1/level2/level3')).toBe(true)
    })

    it('should list directory contents', async () => {
      const dirPath = '/listtest'
      
      await filesystem.mkdir(dirPath)
      await filesystem.writeFile('/listtest/file1.txt', 'content1')
      await filesystem.writeFile('/listtest/file2.txt', 'content2')
      await filesystem.mkdir('/listtest/subdir')

      const entries = await filesystem.readdir(dirPath)

      expect(entries).toHaveLength(3)
      
      const names = entries.map(e => e.name).sort()
      expect(names).toEqual(['file1.txt', 'file2.txt', 'subdir'])

      const file1 = entries.find(e => e.name === 'file1.txt')
      const subdir = entries.find(e => e.name === 'subdir')

      expect(file1?.isDirectory).toBe(false)
      expect(subdir?.isDirectory).toBe(true)
    })

    it('should handle empty directories', async () => {
      const dirPath = '/emptydir'
      
      await filesystem.mkdir(dirPath)
      const entries = await filesystem.readdir(dirPath)

      expect(entries).toHaveLength(0)
    })

    it('should throw error when listing non-existent directory', async () => {
      await expect(filesystem.readdir('/nonexistent'))
        .rejects.toThrow('Directory not found: /nonexistent')
    })

    it('should throw error when creating directory that already exists', async () => {
      const dirPath = '/duplicate'
      
      await filesystem.mkdir(dirPath)
      await expect(filesystem.mkdir(dirPath))
        .rejects.toThrow('Directory already exists: /duplicate')
    })

    it('should handle directories with many files', async () => {
      const dirPath = '/manyfiles'
      await filesystem.mkdir(dirPath)

      // Create 100 files
      for (let i = 0; i < 100; i++) {
        await filesystem.writeFile(`${dirPath}/file${i}.txt`, `Content ${i}`)
      }

      const entries = await filesystem.readdir(dirPath)
      expect(entries).toHaveLength(100)

      // Verify all files are present
      for (let i = 0; i < 100; i++) {
        const file = entries.find(e => e.name === `file${i}.txt`)
        expect(file).toBeDefined()
        expect(file?.isDirectory).toBe(false)
      }
    })
  })

  describe('File Existence Checks', () => {
    it('should return true for existing files', async () => {
      const path = '/exists.txt'
      
      await filesystem.writeFile(path, 'content')
      const exists = await filesystem.exists(path)

      expect(exists).toBe(true)
    })

    it('should return true for existing directories', async () => {
      const path = '/existsdir'
      
      await filesystem.mkdir(path)
      const exists = await filesystem.exists(path)

      expect(exists).toBe(true)
    })

    it('should return false for non-existent files', async () => {
      const exists = await filesystem.exists('/nonexistent.txt')
      expect(exists).toBe(false)
    })

    it('should return false for non-existent directories', async () => {
      const exists = await filesystem.exists('/nonexistentdir')
      expect(exists).toBe(false)
    })

    it('should handle root directory', async () => {
      const exists = await filesystem.exists('/')
      expect(exists).toBe(true)
    })
  })

  describe('File Removal', () => {
    it('should remove existing files', async () => {
      const path = '/remove.txt'
      
      await filesystem.writeFile(path, 'content')
      expect(await filesystem.exists(path)).toBe(true)

      await filesystem.remove(path)
      expect(await filesystem.exists(path)).toBe(false)
    })

    it('should remove empty directories', async () => {
      const path = '/removedir'
      
      await filesystem.mkdir(path)
      expect(await filesystem.exists(path)).toBe(true)

      await filesystem.remove(path)
      expect(await filesystem.exists(path)).toBe(false)
    })

    it('should remove directories with contents', async () => {
      const dirPath = '/removewithcontent'
      
      await filesystem.mkdir(dirPath)
      await filesystem.writeFile('/removewithcontent/file.txt', 'content')
      await filesystem.mkdir('/removewithcontent/subdir')
      await filesystem.writeFile('/removewithcontent/subdir/nested.txt', 'nested')

      await filesystem.remove(dirPath)
      expect(await filesystem.exists(dirPath)).toBe(false)
      expect(await filesystem.exists('/removewithcontent/file.txt')).toBe(false)
      expect(await filesystem.exists('/removewithcontent/subdir')).toBe(false)
    })

    it('should throw error when removing non-existent file', async () => {
      await expect(filesystem.remove('/nonexistent.txt'))
        .rejects.toThrow('File or directory not found: /nonexistent.txt')
    })

    it('should handle removing root directory gracefully', async () => {
      // Should not actually remove root, but shouldn't crash
      await expect(filesystem.remove('/'))
        .rejects.toThrow()
    })
  })

  describe('Path Handling', () => {
    it('should handle absolute paths', async () => {
      await filesystem.writeFile('/absolute/path/file.txt', 'content')
      const content = await filesystem.readFile('/absolute/path/file.txt')
      expect(content).toBe('content')
    })

    it('should normalize paths with multiple slashes', async () => {
      await filesystem.writeFile('//double//slash//file.txt', 'content')
      const content = await filesystem.readFile('/double/slash/file.txt')
      expect(content).toBe('content')
    })

    it('should handle paths with trailing slashes', async () => {
      await filesystem.mkdir('/trailing/')
      expect(await filesystem.exists('/trailing')).toBe(true)
      expect(await filesystem.exists('/trailing/')).toBe(true)
    })

    it('should handle empty path components', async () => {
      await filesystem.writeFile('/empty//components/file.txt', 'content')
      const content = await filesystem.readFile('/empty/components/file.txt')
      expect(content).toBe('content')
    })

    it('should handle special characters in paths', async () => {
      const specialPath = '/special chars áéí/file name.txt'
      await filesystem.writeFile(specialPath, 'content')
      const content = await filesystem.readFile(specialPath)
      expect(content).toBe('content')
    })

    it('should be case sensitive', async () => {
      await filesystem.writeFile('/CaseSensitive.txt', 'upper')
      await filesystem.writeFile('/casesensitive.txt', 'lower')

      const upperContent = await filesystem.readFile('/CaseSensitive.txt')
      const lowerContent = await filesystem.readFile('/casesensitive.txt')

      expect(upperContent).toBe('upper')
      expect(lowerContent).toBe('lower')
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle very long file names', async () => {
      const longName = 'a'.repeat(255)
      const path = `/${longName}.txt`

      await filesystem.writeFile(path, 'content')
      const content = await filesystem.readFile(path)
      expect(content).toBe('content')
    })

    it('should handle very deep directory structures', async () => {
      let path = ''
      for (let i = 0; i < 10; i++) {
        path += `/level${i}`
        await filesystem.mkdir(path)
      }

      const filePath = `${path}/deep.txt`
      await filesystem.writeFile(filePath, 'deep content')
      const content = await filesystem.readFile(filePath)
      expect(content).toBe('deep content')
    })

    it('should handle concurrent operations', async () => {
      const promises: Promise<void>[] = []
      
      // Create multiple files concurrently
      for (let i = 0; i < 10; i++) {
        promises.push(filesystem.writeFile(`/concurrent${i}.txt`, `content${i}`))
      }

      await Promise.all(promises)

      // Verify all files were created
      for (let i = 0; i < 10; i++) {
        const content = await filesystem.readFile(`/concurrent${i}.txt`)
        expect(content).toBe(`content${i}`)
      }
    })

    it('should handle operations on files vs directories correctly', async () => {
      await filesystem.mkdir('/isdir')
      await filesystem.writeFile('/isfile.txt', 'content')

      // Should not be able to read directory as file
      await expect(filesystem.readFile('/isdir'))
        .rejects.toThrow()

      // Should not be able to list file as directory
      await expect(filesystem.readdir('/isfile.txt'))
        .rejects.toThrow()
    })

    it('should maintain file metadata', async () => {
      const path = '/metadata.txt'
      const content = 'test content'
      
      await filesystem.writeFile(path, content)
      const entries = await filesystem.readdir('/')
      
      const file = entries.find(e => e.name === 'metadata.txt')
      expect(file).toBeDefined()
      expect(file?.isDirectory).toBe(false)
      expect(file?.size).toBe(content.length)
      expect(file?.lastModified).toBeInstanceOf(Date)
    })

    it('should handle rapid file modifications', async () => {
      const path = '/rapid.txt'
      
      // Rapidly modify the same file
      for (let i = 0; i < 10; i++) {
        await filesystem.writeFile(path, `version ${i}`)
      }

      const finalContent = await filesystem.readFile(path)
      expect(finalContent).toBe('version 9')
    })
  })

  describe('Directory Tree Operations', () => {
    beforeEach(async () => {
      // Create a complex directory structure
      await filesystem.mkdir('/project')
      await filesystem.mkdir('/project/src')
      await filesystem.mkdir('/project/src/components')
      await filesystem.mkdir('/project/src/utils')
      await filesystem.mkdir('/project/tests')
      await filesystem.mkdir('/project/docs')
      
      await filesystem.writeFile('/project/README.md', '# Project')
      await filesystem.writeFile('/project/package.json', '{}')
      await filesystem.writeFile('/project/src/index.js', 'console.log("main")')
      await filesystem.writeFile('/project/src/components/Button.js', 'export default Button')
      await filesystem.writeFile('/project/src/utils/helpers.js', 'export const helper = () => {}')
      await filesystem.writeFile('/project/tests/main.test.js', 'test("main", () => {})')
      await filesystem.writeFile('/project/docs/api.md', '# API')
    })

    it('should list nested directory contents correctly', async () => {
      const srcEntries = await filesystem.readdir('/project/src')
      expect(srcEntries).toHaveLength(3) // index.js, components/, utils/
      
      const componentEntries = await filesystem.readdir('/project/src/components')
      expect(componentEntries).toHaveLength(1) // Button.js
      
      const utilEntries = await filesystem.readdir('/project/src/utils')
      expect(utilEntries).toHaveLength(1) // helpers.js
    })

    it('should handle removal of nested structures', async () => {
      await filesystem.remove('/project/src')
      
      expect(await filesystem.exists('/project/src')).toBe(false)
      expect(await filesystem.exists('/project/src/components')).toBe(false)
      expect(await filesystem.exists('/project/src/components/Button.js')).toBe(false)
      
      // Other directories should still exist
      expect(await filesystem.exists('/project')).toBe(true)
      expect(await filesystem.exists('/project/tests')).toBe(true)
      expect(await filesystem.exists('/project/docs')).toBe(true)
    })

    it('should maintain directory structure integrity', async () => {
      // Remove a file and verify directory structure remains
      await filesystem.remove('/project/src/components/Button.js')
      
      expect(await filesystem.exists('/project/src/components')).toBe(true)
      expect(await filesystem.exists('/project/src')).toBe(true)
      
      const componentEntries = await filesystem.readdir('/project/src/components')
      expect(componentEntries).toHaveLength(0)
    })
  })
})