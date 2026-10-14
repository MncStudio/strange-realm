/** Presentation-only manifests: never import server scenario definitions here. */
export interface SceneAsset { src: string; alt: string; tone: 'fog' | 'corridor' | 'archive' }
export interface ScenarioArt {
  scenarioId: string; cover: SceneAsset; defaultScene: SceneAsset;
  scenes: Record<string, string>; assets: Record<string, SceneAsset>; endings: Record<string, string>;
}
const manifests = Object.values(import.meta.glob<ScenarioArt>('./*/art.json', { eager: true, import: 'default' }));
export function sceneAsset(scenarioId: string, eventId?: string, endingId?: string): SceneAsset | undefined {
  const art = manifests.find(entry => entry.scenarioId === scenarioId);
  if (!art) return;
  if (endingId) return art.assets[art.endings[endingId]!] || art.defaultScene;
  if (!eventId) return art.cover;
  return art.assets[art.scenes[eventId]!] || art.defaultScene;
}
