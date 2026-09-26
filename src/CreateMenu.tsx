import { useState } from "react";
import { Plus } from "lucide-react";
import { ContextMenu } from "./ContextMenu";
import { anchorBelow, type Anchor } from "./sidebarTypes";

export function CreateMenu({
  disabled,
  create,
}: {
  disabled: boolean;
  create: (kind: "note" | "folder") => void;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  return (
    <>
      <button
        className="icon"
        aria-label="Create note or folder"
        title="Create note or folder"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event) =>
          setAnchor(anchor ? null : anchorBelow(event.currentTarget))
        }
      >
        <Plus size={16} />
      </button>
      {anchor && !disabled && (
        <ContextMenu
          anchor={anchor}
          label="Create note or folder"
          onClose={() => setAnchor(null)}
          items={[
            { label: "Create note", run: () => create("note") },
            { label: "Create folder", run: () => create("folder") },
          ]}
        />
      )}
    </>
  );
}
