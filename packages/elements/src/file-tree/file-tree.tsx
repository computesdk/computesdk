import { useState } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FileTreeNode {
  name: string;
  type: 'file' | 'folder';
  children?: FileTreeNode[];
}

interface FileTreeItemProps {
  node: FileTreeNode;
  level?: number;
  onSelect?: (node: FileTreeNode) => void;
  selectedPath?: string;
}

function FileTreeItem({ node, level = 0, onSelect, selectedPath }: FileTreeItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isFolder = node.type === 'folder';
  const hasChildren = isFolder && node.children && node.children.length > 0;
  const isSelected = selectedPath === node.name;

  const handleClick = () => {
    if (isFolder) {
      setIsOpen(!isOpen);
    }
    onSelect?.(node);
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-1 px-2 rounded-md cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors",
          isSelected && "bg-accent text-accent-foreground",
          "select-none"
        )}
        style={{ paddingLeft: `${level * 1.5 + 0.5}rem` }}
        onClick={handleClick}
      >
        {isFolder ? (
          <span className="flex-shrink-0">
            {hasChildren ? (
              isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )
            ) : (
              <span className="w-4" />
            )}
          </span>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}

        <span className="flex-shrink-0">
          {isFolder ? (
            isOpen ? (
              <FolderOpen className="h-4 w-4 text-blue-500" />
            ) : (
              <Folder className="h-4 w-4 text-blue-500" />
            )
          ) : (
            <File className="h-4 w-4 text-muted-foreground" />
          )}
        </span>

        <span className="text-sm truncate">{node.name}</span>
      </div>

      {isFolder && isOpen && hasChildren && (
        <div>
          {node.children!.map((child, index) => (
            <FileTreeItem
              key={`${child.name}-${index}`}
              node={child}
              level={level + 1}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export interface FileTreeProps {
  data: FileTreeNode[];
  onSelect?: (node: FileTreeNode) => void;
  selectedPath?: string;
  className?: string;
}

export default function FileTree({ data, onSelect, selectedPath, className }: FileTreeProps) {
  return (
    <div className={cn("w-full border rounded-lg p-2 bg-background", className)}>
      {data.map((node, index) => (
        <FileTreeItem
          key={`${node.name}-${index}`}
          node={node}
          onSelect={onSelect}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}