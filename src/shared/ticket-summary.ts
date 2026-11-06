/** Сводка тикета - страница `*.summary.html`, которую агент пишет, закрыв тикет (_scratch/ticket-summary). */
export function isSummaryFile(path: string): boolean {
  return /\.summary\.html$/i.test(path);
}

/** Roadmap скретча - `roadmap.html` прямо в папке скретча, `_scratch/<скретч>/roadmap.html` (_scratch/roadmap-page). */
export function isRoadmapFile(path: string): boolean {
  return /(?:^|[\\/])_scratch[\\/][^\\/]+[\\/]roadmap\.html$/i.test(path);
}

