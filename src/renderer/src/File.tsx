import { useCallback, useEffect, useState } from "react";
import type { FileInfo } from "../../preload";
import { Editor, type EditStatus } from "./Editor";

const SIZE_UNITS = ["Б", "КБ", "МБ", "ГБ"];

/** Размер файла для чтения глазами: 1048576 в карточке не читается никак. */
function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}

/**
 * Файл показывается по содержимому: картинка - картинкой, текст, в том числе markdown и код, -
 * в редакторе с подсветкой, прочее - размером и git-статусом (имя и путь стоят в шапке карточки).
 */
export function FileBody({
  path,
  onStatus,
}: {
  path: string;
  onStatus: (status: EditStatus) => void;
}) {
  const [info, setInfo] = useState<FileInfo | null | undefined>(undefined);

  useEffect(() => {
    const reread = () => void window.fileApi.read(path).then(setInfo);
    reread();
    // За файлом следит то же, что за папкой и за файлом заметки: правка снаружи доходит сама.
    return window.folderApi.watch(path, () => {
      reread();
    });
  }, [path]);

  const save = useCallback((text: string) => window.fileApi.write(path, text), [path]);

  if (info === undefined) return <div className="card__note">читаю...</div>;
  if (info === null) return <div className="card__note">файл не читается</div>;

  if (info.preview.kind === "image") {
    return <img className="card__image nodrag" src={info.preview.dataUrl} alt={path} />;
  }
  if (info.preview.kind === "text") {
    return <Editor path={path} text={info.preview.text} onSave={save} onStatus={onStatus} />;
  }
  return (
    <div className="card__note">
      {formatSize(info.size)}, {info.gitStatus}
    </div>
  );
}
