import type { Meta, StoryObj } from '@storybook/react-vite';

import FileTree, { FileTreeNode } from './file-tree';

const meta: Meta<typeof FileTree> = {
  title: 'Components/FileTree',
  component: FileTree,
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const sampleData: FileTreeNode[] = [
  {
    name: 'src',
    type: 'folder',
    children: [
      {
        name: 'components',
        type: 'folder',
        children: [
          { name: 'Button.tsx', type: 'file' },
          { name: 'Card.tsx', type: 'file' },
          { name: 'Input.tsx', type: 'file' },
        ],
      },
      {
        name: 'utils',
        type: 'folder',
        children: [
          { name: 'helpers.ts', type: 'file' },
          { name: 'constants.ts', type: 'file' },
        ],
      },
      { name: 'App.tsx', type: 'file' },
      { name: 'main.tsx', type: 'file' },
    ],
  },
  {
    name: 'public',
    type: 'folder',
    children: [
      { name: 'favicon.ico', type: 'file' },
      { name: 'index.html', type: 'file' },
    ],
  },
  { name: 'package.json', type: 'file' },
  { name: 'tsconfig.json', type: 'file' },
  { name: 'README.md', type: 'file' },
];

export const Default: Story = {
  args: {
    data: sampleData,
  },
};

export const WithSelection: Story = {
  args: {
    data: sampleData,
    selectedPath: 'Button.tsx',
    onSelect: (node) => console.log('Selected:', node),
  },
};

export const SimpleTree: Story = {
  args: {
    data: [
      { name: 'index.html', type: 'file' },
      { name: 'styles.css', type: 'file' },
      {
        name: 'scripts',
        type: 'folder',
        children: [
          { name: 'main.js', type: 'file' },
          { name: 'utils.js', type: 'file' },
        ],
      },
    ],
  },
};
