import { useEffect, useState } from "react";
import type { FolderRead } from "../../preload";

/** Содержимое папки: читается один раз и дальше перечитывается по слежению за диском. */
export function useFolder(path: string): FolderRead | undefined {
  const [contents, setContents] = useState<FolderRead | undefined>(undefined);
  useEffect(() => {
    const reread = () => void window.folderApi.read(path).then(setContents);
    reread();
    // Слежение снимается вместе с карточкой.
    return window.folderApi.watch(path, reread);
  }, [path]);
  return contents;
}
