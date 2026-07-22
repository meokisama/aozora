/**
 * Curated Yomitan dictionaries offered for one-click install. "Install"
 * downloads the ZIP in the main process and feeds it through the normal import
 * pipeline; the installed row is stamped with this entry's `id` (source_id) so
 * the list shows Install vs. Installed exactly — no title guessing.
 */
export interface RecommendedDictionary {
  /** Stable catalog id: stamped onto the installed dictionary (source_id) and used for install-progress targeting. */
  id: string;
  /** Display name in the list. */
  title: string;
  description: string;
  /** Direct download URL of the Yomitan `.zip` (format 3). */
  url: string;
}

export const RECOMMENDED_DICTIONARIES: RecommendedDictionary[] = [
  {
    id: "jitendex",
    title: "Jitendex",
    description: "Japanese-English dictionary with example sentences, usage and etymology notes, cross-references and antonyms.",
    url: "https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip",
  },
  {
    id: "jmnedict",
    title: "JMnedict",
    description: "Proper names — people, places, organizations and works.",
    url: "https://github.com/yomidevs/jmdict-yomitan/releases/latest/download/JMnedict.zip",
  },
  {
    id: "jpdb-freq",
    title: "JPDB",
    description: "Word-frequency ratings (kana) showing how common each term is.",
    url: "https://github.com/Kuuuube/yomitan-dictionaries/raw/main/dictionaries/JPDB_v2.2_Frequency_Kana_2024-10-13.zip",
  },
  {
    id: "kanjidic",
    title: "KANJIDIC",
    description: "Kanji readings, meanings and stroke data (English).",
    url: "https://github.com/yomidevs/jmdict-yomitan/releases/latest/download/KANJIDIC_english.zip",
  },
  {
    id: "accent-v2",
    title: "アクセント辞典v2",
    description: "Pitch-accent dictionary for Japanese pronunciation.",
    url: "https://cloud.meoki.vn/dictionaries/%5BPitch%5D%20%E3%82%A2%E3%82%AF%E3%82%BB%E3%83%B3%E3%83%88%E8%BE%9E%E5%85%B8v2.zip",
  },
];
