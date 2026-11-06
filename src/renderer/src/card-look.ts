// Вид карточки по её идентификатору, виду и имени. Отдельно от Card.tsx: файл с компонентом должен
// экспортировать только компоненты, иначе правка карточки в `npm run dev` не подменяется на лету,
// и окно пересоздаёт все карточки вместе с процессами терминалов.
import { ROOT_CARD_ID, type CardKind } from "../../shared/canvas-model";

/**
 * Как карточка выглядит. Корень - папка по виду, но на полотне он один и отличается от папок,
 * которые из него растут; остальные выглядят по своему виду. Стрелки красятся по нему же.
 */
export type Look = CardKind | "root";

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

/** Вид оболочки карточки: картинка - файл, но у неё задний слой, как у консолей. */
export function shellOf(id: string, kind: CardKind, name: string): Look | "image" {
  if (kind === "file" && IMAGE.test(name)) return "image";
  return id === ROOT_CARD_ID ? "root" : kind;
}
