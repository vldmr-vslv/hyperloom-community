// Скрытие значений секретов в тексте, который приложение само отдаёт агенту: вывод команды и
// содержимое файла по стрелке. Ни Electron, ни DOM здесь нет.

const HIDDEN = "<скрыто>";

/**
 * Слова имени, после которых значение считается секретом. Слово целиком: KEYBOARD - не KEY.
 * PWD нет нарочно: в выводе env это текущая папка.
 */
const SECRET_WORDS = new Set(["SESSION", "KEY", "TOKEN", "SECRET", "PASSWORD", "PASS"]);

/**
 * Имя, разделитель и значение: в кавычках целиком, без кавычек - до конца строки, но не дальше
 * кавычки, ; & и закрывающей скобки, чтобы JSON, код и адрес уходили целыми. Разделитель не
 * переходит строку: у "TOKEN=" без значения следующая строка цела.
 * $ перед именем запрещён: иначе в $env:API_KEY="x" именем стало бы env, а секрет - его значением.
 */
const ASSIGNMENT =
  /(?<![\w.$-])([A-Za-z][\w.-]*)(["']?[ \t]*[:=][ \t]*)(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'`;&=)\]}][^\r\n"'`;&)\]}]*))/g;
const BEARER = /\b(bearer[ \t]+)[^\s"'`,;]+/gi;

/** Слова имени: по _, -, . и по смене регистра (apiKey - api и Key, APIKey - API и Key). */
function isSecretName(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])|([A-Z])([A-Z][a-z])/g, "$1$3_$2$4")
    .split(/[_.-]+/)
    .some((word) => SECRET_WORDS.has(word.toUpperCase()));
}

/**
 * Текст, в котором значения секретов заменены на "<скрыто>": TG_SESSION=1BQ... уходит как
 * TG_SESSION=<скрыто>, Bearer abc - как Bearer <скрыто>.
 * ponytail: секрет узнаётся по имени, а не по виду значения. Потолок - уходят как есть ключ без
 * имени (голый sk-...), слитное имя (PGPASSWORD), пароль в адресе (user:pass@host) и Basic, а
 * key: в обычном тексте прячет остаток строки. Апгрейд, если упрётся, - образцы форматов ключей.
 */
export function hideSecrets(text: string): string {
  return text
    .replace(BEARER, `$1${HIDDEN}`)
    .replace(ASSIGNMENT, (whole, name: string, sep: string, dq?: string, sq?: string) => {
      if (!isSecretName(name)) return whole;
      const value = dq !== undefined ? `"${HIDDEN}"` : sq !== undefined ? `'${HIDDEN}'` : HIDDEN;
      return name + sep + value;
    });
}
