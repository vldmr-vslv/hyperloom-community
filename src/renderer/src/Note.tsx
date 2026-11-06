import { useCallback, useEffect, useRef, useState } from "react";

/** Файл пишется не на каждую букву, а когда набор прекратился. */
const SAVE_DELAY_MS = 300;

/**
 * Тело карточки заметки: поле ввода, за которым стоит обычный markdown-файл в папке проекта.
 * Набранное уезжает в файл, правка файла снаружи приходит в поле - без перезапуска.
 *
 * Спор решается в пользу диска: изменился файл - карточка показывает то, что на диске.
 * Своя же запись поле не дёргает: пока набранное не доехало до файла, чтение пропускается.
 */
export function NoteBody({ path }: { path: string }) {
  const [text, setText] = useState<string | null | undefined>(undefined);
  // Набранное, ещё не доехавшее до диска. null - в поле то же, что в файле.
  const typed = useRef<string | null>(null);
  const timer = useRef<NodeJS.Timeout | null>(null);

  const save = useCallback(() => {
    const saving = typed.current;
    if (saving === null) return;
    void window.noteApi.write(path, saving).then(() => {
      // Пока запись ехала, могли набрать ещё: тогда в файле по-прежнему не то, что в поле.
      if (typed.current === saving) typed.current = null;
    });
  }, [path]);

  const change = useCallback(
    (next: string) => {
      setText(next);
      typed.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, SAVE_DELAY_MS);
    },
        [save],
  );

  useEffect(() => {
    const reread = () => {
      if (typed.current !== null) return; // набранное ещё не в файле, читать нечего
      void window.noteApi.read(path).then((disk) => {
        // Пока читали, могли начать печатать: набранное важнее прочитанного.
        if (typed.current === null) setText(disk);
      });
    };

    reread();
        // За файлом заметки следит то же, что за папкой: правка снаружи доходит сама.
    const unwatch = window.folderApi.watch(path, () => {
      reread();
    });
    return () => {
      unwatch();
      // Карточку закрыли, не дождавшись задержки: набранное дописывается здесь, а не теряется.
      if (timer.current) clearTimeout(timer.current);
      save();
    };
    }, [path, save]);

  if (text === undefined) return <div className="card__note">читаю...</div>;
  // Карточка остаётся на полотне: файл могут вернуть, а связи и позиция нужны и без него.
  if (text === null) return <div className="card__missing">файла заметки нет на диске</div>;

  return (
    // nodrag и nowheel: внутри карточки набор и прокрутка текста, а не перетаскивание и зум.
    <textarea
      className="card__text nodrag nowheel"
      value={text}
      onChange={(event) => change(event.target.value)}
      spellCheck={false}
      aria-label="Текст заметки"
    />
  );
}
