import type { Meta, StoryObj } from '@storybook/react-vite';

import FileTree from './file-tree';

const meta: Meta<typeof FileTree> = {
  title: 'Components/FileTree',
  component: FileTree,
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
