import { useEffect, useState } from "react";
import { isRoadmapFile, isSummaryFile } from "../../shared/ticket-summary";

/** Видео, которое карточка файла играет плеером Chromium; протокол страниц отдаёт его так же, как PDF. */
export const isVideo = (path: string) => /\.(mp4|webm|mov|m4v|ogv)$/i.test(path);


/** HTML-страница, PDF или видео из проекта во фрейме карточки файла: страница получает только файлы своей папки. */
export function BrowserBody({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  // Номер перезагрузки: новый адрес заставляет фрейм загрузить страницу заново.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    void window.fileApi.page(path).then((next) => alive && setUrl(next));
    const stop = window.folderApi.watch(path, () => setVersion((count) => count + 1));
    return () => {
      alive = false;
      stop();
    };
  }, [path]);


  if (url === undefined) return <div className="card__note">открываю...</div>;
  if (url === null) return <div className="card__note">страница не открывается</div>;
  const pdf = /\.pdf$/i.test(path);
  if (isVideo(path)) return <video className="card__video nodrag nowheel" src={version ? `${url}?v=${version}` : url} controls preload="metadata" title={path} />;
  const page = (
    <iframe
      className={`card__page nodrag nowheel${pdf || isSummaryFile(path) || isRoadmapFile(path) ? " card__page--dark" : ""}`}
      // Страница с адреса перезагружается новым фреймом (key), а не ?v=: к её адресу параметры не дописываются.
      src={version ? `${url}?v=${version}` : url}
      // PDF во фрейме с sandbox Chromium не открывает (ERR_BLOCKED_BY_CLIENT, Electron 44). Источник у фрейма и без
      // него свой, work-page, до окна приложения он не дотягивается.
      sandbox={pdf ? undefined : "allow-scripts allow-same-origin allow-forms allow-modals"}
      // Страница со своим источником пишет в буфер обмена, только если фрейм это разрешил: кнопки "копировать"
      // в сводке тикета.
      allow="clipboard-write"
      // Не title: tips.ts делает из него плашку с длинным путём, и она висла над любой точкой страницы.
      aria-label={path}
    />
  );
  return page;
}
