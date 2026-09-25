[🇺🇸 English](README.md) | [🇯🇵 日本語](README.ja.md) | [🇨🇳 简体中文](README.zh-CN.md) | [🇰🇷 한국어](README.ko.md) | [🇪🇸 Español](README.es.md) | [🇩🇪 Deutsch](README.de.md) | **🇫🇷 Français** | [🇵🇹 Português (BR)](README.pt-BR.md)

# Illustrator MCP Server

[![npm](https://img.shields.io/npm/v/illustrator-mcp-server.svg?style=flat-square&colorA=18181B&colorB=18181B)](https://www.npmjs.com/package/illustrator-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-18181B.svg?style=flat-square&colorA=18181B)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-18181B.svg?style=flat-square&colorA=18181B)]()
[![Illustrator](https://img.shields.io/badge/Illustrator-CC%202024%2B-18181B.svg?style=flat-square&colorA=18181B)](https://www.adobe.com/products/illustrator.html)
[![MCP](https://img.shields.io/badge/MCP-Compatible-18181B.svg?style=flat-square&colorA=18181B)](https://modelcontextprotocol.io/)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-FF5E5B?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

Un serveur [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) pour lire, manipuler et exporter les données de conception Adobe Illustrator — avec 67 outils intégrés.

Pilotez Illustrator directement depuis des assistants IA comme Claude — extrayez les informations de conception pour l'implémentation web, vérifiez les données prêtes à l'impression et exportez vos assets.

Tout ce que le MCP Illustrator officiel d'Adobe (bêta) peut faire — et bien plus encore. Voir la [comparaison](#-comparaison-avec-le-mcp-officiel-dadobe-pour-illustrator).

[![illustrator mcp server MCP server](https://glama.ai/mcp/servers/ie3jp/illustrator-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/ie3jp/illustrator-mcp-server)

---

## 🎨 Galerie

Toutes les créations ci-dessous ont été entièrement réalisées par Claude via une conversation en langage naturel — aucune manipulation manuelle d'Illustrator.

<table>
<tr>
<td align="center"><img src="docs/images/example-event-poster.png" width="300" alt="Affiche d'événement — SYNC TOKYO 2026" /><br><b>Affiche d'événement</b></td>
<td align="center"><img src="docs/images/example-logo-concepts.png" width="300" alt="Concepts de logo — Slow Drip Coffee Co." /><br><b>Concepts de logo</b></td>
</tr>
<tr>
<td align="center"><img src="docs/images/example-business-card.png" width="300" alt="Carte de visite — KUMO Studio" /><br><b>Carte de visite</b></td>
<td align="center"><img src="docs/images/example-twilight-geometry.png" width="300" alt="Twilight Geometry — paysage géométrique abstrait" /><br><b>Twilight Geometry</b></td>
</tr>
</table>

> Voir les [décompositions détaillées](#exemple--mire-de-test-smpte) ci-dessous pour les prompts, l'utilisation des outils et la structure des plans de travail.

---

> [!TIP]
> Développer et maintenir cet outil demande du temps et des ressources.
> Si cela aide votre workflow, votre soutien compte beaucoup — [☕ offrez-moi un café !](https://ko-fi.com/cyocun)

---

## 🚀 Démarrage rapide

### 🛠️ Claude Code

Nécessite [Node.js 20+](https://nodejs.org/).

```bash
claude mcp add illustrator-mcp -- npx illustrator-mcp-server
```

### 🖥️ Claude Desktop

1. Téléchargez **`illustrator-mcp-server.mcpb`** depuis [GitHub Releases](https://github.com/ie3jp/illustrator-mcp-server/releases/latest)
2. Ouvrez Claude Desktop → **Settings** → **Extensions**
3. Glissez-déposez le fichier `.mcpb` dans le panneau Extensions
4. Cliquez sur le bouton **Install**

<details>
<summary><strong>Alternative : configuration manuelle (toujours à jour via npx)</strong></summary>

> [!NOTE]
> L'extension `.mcpb` ne se met pas à jour automatiquement. Pour mettre à jour, téléchargez la nouvelle version et réinstallez-la. Si vous préférez les mises à jour automatiques, utilisez plutôt la méthode npx ci-dessous.

Nécessite [Node.js 20+](https://nodejs.org/). Ouvrez le fichier de configuration et ajoutez les paramètres de connexion.

#### 1. Ouvrir le fichier de configuration

Depuis la barre de menu de Claude Desktop :

**Claude** → **Settings...** → **Developer** (dans la barre latérale gauche) → Cliquez sur le bouton **Edit Config**

#### 2. Ajouter les paramètres

```json
{
  "mcpServers": {
    "illustrator": {
      "command": "npx",
      "args": ["illustrator-mcp-server"]
    }
  }
}
```

> [!NOTE]
> Si vous avez installé Node.js via un gestionnaire de versions (nvm, mise, fnm, etc.), Claude Desktop peut ne pas trouver `npx`. Dans ce cas, utilisez le chemin complet :
> ```json
> "command": "/full/path/to/npx"
> ```
> Exécutez `which npx` dans votre terminal pour trouver le chemin.

#### 3. Enregistrer et redémarrer

1. Enregistrez le fichier et fermez l'éditeur de texte
2. **Quittez complètement** Claude Desktop (⌘Q / Ctrl+Q) puis rouvrez-le

</details>

> [!CAUTION]
> L'IA peut faire des erreurs. Ne vous fiez pas trop au résultat — **un humain doit toujours effectuer la vérification finale des données à remettre**. L'utilisateur est responsable des résultats.

> [!NOTE]
> **macOS :** au premier lancement, autorisez l'accès à l'automatisation dans Réglages Système > Confidentialité et sécurité > Automatisation.

> [!NOTE]
> La plupart des outils de modification mettent Illustrator au premier plan pendant leur exécution. Les outils de lecture et `export` s'exécutent sans changer d'application ; `export_pdf` ne met Illustrator au premier plan que pour tracer des traits de coupe japonais.

> [!NOTE]
> **Vos fichiers sont protégés par défaut.** `close_document` n'abandonne pas les modifications non enregistrées sauf si vous le demandez explicitement (`save: false`), et `export`, `export_pdf`, `save_document` (enregistrer sous) et `extract_design_tokens` ne remplacent pas un fichier existant sans `overwrite: true`. Si c'est bien ce que vous voulez, demandez simplement à Claude de « fermer sans enregistrer » ou d'« écraser le fichier ».

### Plusieurs versions d'Illustrator

Si plusieurs versions d'Illustrator sont installées, vous pouvez indiquer à Claude quelle version utiliser pendant la conversation. Dites simplement quelque chose comme « Utilise Illustrator 2024 » et l'outil `set_illustrator_version` ciblera cette version.


**Versions prises en charge :** Illustrator 2024 (v28) et versions ultérieures sont vérifiées. Illustrator 2020–2023 (v24–v27) devraient fonctionner — toutes les API ExtendScript utilisées par ce serveur existent depuis la v24 — mais elles ne sont **pas vérifiées** : les outils renvoient donc un avertissement lorsqu'ils s'exécutent sur ces versions. Les versions antérieures à 2020 (v24) ne sont pas prises en charge. Si quelque chose ne fonctionne pas sur une version non vérifiée, [ouvrez une issue](https://github.com/ie3jp/illustrator-mcp-server/issues).
> [!NOTE]
> Si Illustrator est déjà en cours d'exécution, le serveur se connecte à l'instance en cours, indépendamment du paramètre de version. La version n'est utilisée que pour lancer la bonne version lorsqu'Illustrator n'est pas encore démarré.

### Variables d'environnement

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ILLUSTRATOR_MCP_TIMEOUT_NORMAL` | `30000` | Délai d'expiration en millisecondes pour les outils normaux |
| `ILLUSTRATOR_MCP_TIMEOUT_HEAVY` | `60000` | Délai d'expiration en millisecondes pour les outils lourds (placement ou import de fichiers, exportation, contrôle prépresse, guides de style et pastilles de couleur, déclinaisons de taille) |

Augmentez-les lorsqu'un seul appel a besoin de plus de temps que la valeur par défaut : par exemple pour importer un gros SVG avec `import_svg_as_editable` (plus de 100 objets), ou pour exécuter `get_document_structure` / `export_pdf` sur un document volumineux.

Les valeurs doivent être des entiers positifs en millisecondes. Toute autre valeur (`0`, un nombre négatif, une chaîne non numérique ou une valeur supérieure à 2147483647) revient à la valeur par défaut. Elles sont lues une seule fois au démarrage du serveur.

```json
{
  "mcpServers": {
    "illustrator": {
      "command": "npx",
      "args": ["illustrator-mcp-server"],
      "env": {
        "ILLUSTRATOR_MCP_TIMEOUT_NORMAL": "60000",
        "ILLUSTRATOR_MCP_TIMEOUT_HEAVY": "180000"
      }
    }
  }
}
```

---

## 🎬 Ce que vous pouvez faire

```
Toi :   Montre-moi toutes les informations textuelles de ce document
Claude:  → list_text_frames → get_text_frame_detail
         Il y a 12 blocs de texte dans le document.
         Le titre « My Design » utilise Noto Sans JP Bold 48px, couleur #333333 ...
```

```
Toi :   Lance un contrôle préflight prépresse
Claude:  → preflight_check
         ⚠ 2 avertissements :
         - Image basse résolution : image_01.jpg (150dpi) — 300dpi ou plus recommandé
         - Polices non vectorisées : 3 blocs de texte
```

```
Toi :   Vérifie la cohérence du texte
Claude:  → check_text_consistency
         📝 Rapport de cohérence :
         ⚠ « Contact Us » vs « Contact us » — différence de casse
         ❌ « Lorem ipsum » (2 emplacements) — texte de remplissage restant
```

```
Toi :   Crée des déclinaisons de bannière à partir de ce flyer A4
Claude:  → get_document_info → resize_for_variation
         3 déclinaisons de taille créées :
         - 728×90 / 300×250 / 160×600
```

---

## 🆚 Comparaison avec le MCP officiel d'Adobe pour Illustrator

**En bref : tout ce que fait le MCP officiel, ce projet le fait aussi — et bien plus encore.** Adobe intègre un serveur MCP dans **Illustrator Beta** (30.4+, toujours réservé à la Beta en août 2026), axé sur l'analyse et le traitement par lot de documents existants. Ce projet couvre ces mêmes workflows — analyse, recoloration en masse, déclinaisons, export par lot des plans de travail, vérification des polices / liens manquants — et y ajoute ce que le serveur officiel n'offre pas : **la création à partir de zéro, l'enregistrement des documents, les vérifications print et prépresse, ainsi que des outils de design system**. Et tout cela fonctionne sur la version stable d'Illustrator, sans Beta.

| | Ce projet | MCP officiel d'Adobe (bêta) |
|---|---|---|
| Installation | npm (`npx illustrator-mcp-server`) ou installation en un clic via `.mcpb` | Intégré à Illustrator Beta — récupérez une clé d'authentification + URL dans les réglages de l'application, connexion via `mcp-remote` |
| Versions prises en charge | Illustrator 2024+ vérifié / 2020+ non vérifié (macOS / Windows) | Illustrator Beta 30.4+ uniquement |
| Nombre d'outils | 67 | ~40 |
| Analyse & traitement par lot de documents existants | ✅ Analyse de structure / couleurs / polices, recoloration en masse, déclinaisons & jeux de données, export par lot des plans de travail (`artboard:all`), preflight polices & liens manquants | ✅ Son axe principal |
| Création d'objets à partir de zéro | ✅ Ensemble complet — documents, formes, tracés, blocs de texte, texte sur tracé, dégradés | ❌ Pas de nouveaux objets, blocs de texte ni documents \* |
| Enregistrement des documents | ✅ `save_document` (enregistrer / enregistrer sous) | ❌ Export uniquement \* |
| Impression & prépresse | ✅ Traits de coupe, preflight, infos de surimpression / séparation, vectorisation, profils colorimétriques | — |
| Système de design | ✅ Tokens de design, vérification de contraste WCAG, guides de style, cohérence des textes | — |

\* D'après les retours d'utilisateurs en avril 2026 (bêta). Le serveur officiel est en développement actif — consultez la [documentation d'Adobe](https://helpx.adobe.com/illustrator/desktop/connect-with-other-apps-and-tools/about-using-ai-tools-with-illustrator.html) pour l'état le plus récent.

---

## 📖 Recettes

<details>
<summary><b>Extraire les couleurs et les polices pour le CSS</b></summary>

```
Toi :   Résume les couleurs et la typographie de ce design

Claude:  → get_colors → list_text_frames → get_text_frame_detail

         ■ Palette de couleurs
         - Principale : #1A73E8 (CMYK : 85,50,0,0)
         - Secondaire : #34A853
         - Texte : #202124
         - Fond : #FFFFFF

         ■ Typographie
         - Titres : Noto Sans JP Bold / 32px
         - Corps : Noto Sans JP Regular / 16px / line-height : 1.75
         - Légendes : Noto Sans JP Medium / 12px
```

</details>

<details>
<summary><b>Exporter les plans de travail en SVG / PNG</b></summary>

```
Toi :   Exporte tous les plans de travail en SVG avec le texte vectorisé

Claude:  → get_artboards → convert_to_outlines → export (répété)

         4 plans de travail exportés :
         - /output/header.svg
         - /output/hero.svg
         - /output/feature.svg
         - /output/footer.svg
```

</details>

<details>
<summary><b>Vérifier la conformité PDF/X-1a avant remise</b></summary>

```
Toi :   Vérifie si ce document est conforme PDF/X-1a

Claude:  → preflight_check (target_pdf_profile: "x1a")

         ❌ Erreurs de conformité PDF/X-1a :
         - Transparence sur 3 objets (X-1a interdit la transparence)
         - Couleurs RGB trouvées à 2 endroits (X-1a exige CMYK / ton direct uniquement)

         ⚠ Avertissements :
         - 5 polices non vectorisées (incorporation recommandée)
         - Image « photo_02.jpg » à 150dpi (300dpi recommandé)
```

</details>

<details>
<summary><b>Vérifier la qualité des images pour l'impression</b></summary>

```
Toi :   Vérifie la qualité des images importées pour l'impression

Claude:  → get_images (include_print_info: true)

         ■ Rapport de qualité des images :
         ✅ hero.psd — CMYK, 350ppi effectifs
         ⚠ icon_set.png — RGB (incompatible avec le document CMYK), 300ppi effectifs
         ❌ photo_bg.jpg — CMYK, 72ppi effectifs (sur-agrandie)
           → À remplacer par une image de 300dpi+ à la taille réelle
```

</details>

<details>
<summary><b>Vérifier les ratios de contraste de couleur WCAG</b></summary>

```
Toi :   Vérifie les ratios de contraste du texte

Claude:  → check_contrast (auto_detect: true)

         ■ Rapport de contraste WCAG :
         ❌ « Caption » sur « gris clair » — 2.8:1 (AA échec)
         ⚠ « Subheading » sur « blanc » — 4.2:1 (AA Large OK, AA Normal échec)
         ✅ « Body text » sur « blanc » — 12.1:1 (AAA réussi)
```

</details>

---

## Modèles de workflow

Des modèles de workflow prédéfinis sont disponibles dans le sélecteur de prompts de Claude Desktop.

| Modèle | Description |
|----------|-------------|
| `quick-layout` | Collez du contenu textuel et Claude le dispose sur le plan de travail sous forme de titres, corps et légendes |
| `print-preflight-workflow` | Contrôle prépresse complet en 7 étapes (document → preflight → surimpression → séparations → images → couleurs → texte) |

---

## Référence des outils

### Outils de lecture (21)

<details>
<summary>Cliquez pour déployer</summary>

| Outil | Description |
|---|---|
| `get_document_info` | Métadonnées du document (dimensions, mode colorimétrique, profil, etc.) |
| `get_artboards` | Informations sur les plans de travail (position, taille, orientation) |
| `get_layers` | Structure des calques sous forme d'arbre |
| `get_document_structure` | Arbre complet : calques → groupes → objets en un seul appel |
| `list_text_frames` | Liste des blocs de texte (police, taille, nom de style) |
| `get_text_frame_detail` | Tous les attributs d'un bloc de texte précis (crénage, réglages de paragraphe, etc.) |
| `get_colors` | Informations sur les couleurs utilisées (nuanciers, dégradés, tons directs ; chaque couleur utilisée apparaît une fois avec son nombre d'utilisations). `include_diagnostics` pour l'analyse d'impression |
| `get_path_items` | Données de tracés / formes (fond, contour, points d'ancrage) |
| `get_groups` | Groupes, masques d'écrêtage et structure des tracés transparents |
| `get_effects` | Informations sur les effets et l'aspect (opacité, mode de fusion) |
| `get_images` | Informations sur les images incorporées / liées (résolution, détection de liens rompus). `include_print_info` pour la résolution effective par axe et l'incompatibilité d'espace colorimétrique |
| `get_symbols` | Définitions et instances de symboles |
| `get_guidelines` | Informations sur les repères |
| `get_overprint_info` | Réglages de surimpression des tracés, du texte et des images matricielles + détection K100 / noir riche, avec une étiquette heuristique déduite des seules couleurs (elle ne peut pas connaître l'intention) |
| `get_separation_info` | Informations de séparation des couleurs (plaques de quadrichromie et de tons directs réellement utilisées, avec décomptes d'utilisation ; les encres sans utilisation détectée sont listées à part) |
| `get_selection` | Détails des objets actuellement sélectionnés |
| `find_objects` | Recherche par critères (nom, type, couleur, police, etc.) |
| `check_contrast` | Contrôle du ratio de contraste WCAG (manuel ou détection automatique des paires superposées) |
| `extract_design_tokens` | Extraction des design tokens au format CSS custom properties, JSON ou Tailwind config (l'écriture dans un fichier ne remplace jamais un fichier existant sans `overwrite: true`) |
| `list_fonts` | Liste des polices disponibles dans Illustrator (aucun document requis) |
| `convert_coordinate` | Convertit les points entre les systèmes de coordonnées plan de travail et document |

</details>

### Outils de modification (40)

<details>
<summary>Cliquez pour déployer</summary>

| Outil | Description |
|---|---|
| `create_rectangle` | Crée un rectangle (coins arrondis pris en charge) |
| `create_ellipse` | Crée une ellipse |
| `create_line` | Crée une ligne |
| `create_text_frame` | Crée un bloc de texte (texte de point ou texte captif) avec approche, interlignage et alignement de paragraphe optionnels. `font_name` doit être le nom exact renvoyé par `list_fonts` — une police inconnue provoque une erreur au lieu d'être remplacée en silence |
| `create_path` | Crée un tracé personnalisé (avec poignées de Bézier) |
| `place_image` | Place un fichier image matriciel/PDF en lien ou incorporé (le SVG est refusé — utilisez `import_svg_as_editable`) |
| `import_svg_as_editable` | Importe un fichier SVG sous forme de tracés/textes/groupes Illustrator modifiables (et non comme image liée) |
| `modify_object` | Modifie les propriétés d'un objet existant (y compris l'approche, l'interlignage et l'alignement du texte). Un fond/contour appliqué à un groupe ou à un tracé composé s'applique à tous les tracés et textes qu'il contient |
| `convert_to_outlines` | Vectorise le texte |
| `assign_color_profile` | Attribue (marque) un profil colorimétrique (ne convertit pas les valeurs de couleur) |
| `create_document` | Crée un nouveau document (taille, mode colorimétrique) |
| `close_document` | Ferme le document actif (en cas de modifications non enregistrées, ne ferme pas tant que `save` n'est pas précisé) |
| `resize_for_variation` | Crée des déclinaisons de taille à partir d'un plan de travail source (mise à l'échelle proportionnelle) |
| `align_objects` | Aligne et répartit plusieurs objets |
| `replace_color` | Recherche et remplace les couleurs dans le document (avec tolérance) |
| `manage_layers` | Ajoute, renomme, affiche/masque, verrouille/déverrouille, réorganise ou supprime des calques |
| `place_color_chips` | Extrait les couleurs uniques et place des pastilles de nuances hors du plan de travail |
| `save_document` | Enregistre ou enregistre sous le document actif (« enregistrer sous » ne remplace pas un fichier existant sans `overwrite: true`) |
| `open_document` | Ouvre un document depuis un chemin de fichier |
| `group_objects` | Groupe des objets (masques d'écrêtage pris en charge) |
| `ungroup_objects` | Dissocie un groupe, libérant ses enfants |
| `duplicate_objects` | Duplique des objets avec un décalage optionnel |
| `set_z_order` | Modifie l'ordre d'empilement (premier/arrière-plan) |
| `move_to_layer` | Déplace des objets vers un autre calque |
| `delete_objects` | Supprime des objets par UUID (les objets verrouillés nécessitent `force_unlock` ; `undo` peut l'annuler, mais ses étapes suivent l'historique d'Illustrator, pas les appels MCP) |
| `manage_artboards` | Ajoute, supprime, redimensionne, renomme, réorganise les plans de travail |
| `manage_swatches` | Ajoute, met à jour ou supprime des nuances |
| `manage_linked_images` | Relie ou incorpore les images importées |
| `manage_datasets` | Liste/applique/crée des jeux de données, importe/exporte des variables |
| `apply_graphic_style` | Applique un style graphique à des objets |
| `list_graphic_styles` | Liste tous les styles graphiques du document |
| `apply_text_style` | Applique un style de caractère ou de paragraphe au texte |
| `list_text_styles` | Liste tous les styles de caractère et de paragraphe |
| `create_gradient` | Crée des dégradés et les applique aux objets |
| `create_path_text` | Crée du texte le long d'un tracé (approche et alignement optionnels ; `font_name` suit la même règle de nom exact que `create_text_frame`) |
| `place_symbol` | Place ou remplace des instances de symboles |
| `select_objects` | Sélectionne des objets par UUID (sélection multiple prise en charge) |
| `create_crop_marks` | Crée des traits de coupe (repères de rognage) avec détection automatique du style selon la locale (double filet japonais / filet simple occidental) |
| `place_style_guide` | Place un guide de style visuel hors du plan de travail sur un calque non imprimable (couleurs, polices, espacements, marges, interstices des repères). Les annotations de mesure sur le plan de travail lui-même sont optionnelles (`annotate_artboard`) |
| `undo` | Opérations d'annulation/rétablissement (multi-étapes) |

</details>

### Outils d'exportation (2)

<details>
<summary>Cliquez pour déployer</summary>

| Outil | Description |
|---|---|
| `export` | Exportation SVG / PNG / JPG (par plan de travail, sélection ou UUID ; avec une sélection ou un UUID, seul cet objet est exporté ; ne remplace pas un fichier existant sans `overwrite: true`) |
| `export_pdf` | Exportation PDF prête à l'impression (traits de coupe, fond perdu, sous-échantillonnage sélectif, intention de sortie) |

</details>

### Utilitaires (4)

<details>
<summary>Cliquez pour déployer</summary>

| Outil | Description |
|---|---|
| `preflight_check` | Contrôle prépresse (mélange RGB, liens rompus, basse résolution, surimpression de blanc, interaction transparence+surimpression, conformité PDF/X, etc.). Indique quels contrôles ont été complets ou seulement partiels (`coverage`) |
| `check_text_consistency` | Vérification de cohérence du texte (détection de texte de remplissage, variations de notation, liste complète du texte pour analyse par le LLM) |
| `set_workflow` | Définit le mode workflow (web/print) pour outrepasser le système de coordonnées détecté automatiquement |
| `set_illustrator_version` | Choisit la version d'Illustrator à utiliser lorsque plusieurs sont installées |

</details>

---

## Système de coordonnées

Le serveur détecte automatiquement le système de coordonnées à partir du document :

| Type de document | Système de coordonnées | Origine | Axe Y |
|---|---|---|---|
| CMYK / Impression | `document` | Bas-gauche | Vers le haut |
| RGB / Web | `artboard-web` | Haut-gauche du plan de travail | Vers le bas |

- Les **documents CMYK** utilisent le système de coordonnées natif d'Illustrator, conforme aux attentes des designers print
- Les **documents RGB** utilisent un système de coordonnées de type web, plus facile à manipuler pour une IA
- Utilisez `set_workflow` pour outrepasser le système de coordonnées détecté automatiquement si nécessaire
- Toutes les réponses des outils incluent un champ `coordinateSystem` indiquant quel système est actif
- Si la détection automatique échoue, les outils renvoient une erreur au lieu de deviner — précisez `coordinate_system` ou utilisez `set_workflow`

---

## Exemple : mire de test SMPTE

Une mire de barres colorées SMPTE 1920×1080, créée entièrement via des instructions en langage naturel à Claude.

**Prompt :**

> Fais une mire de test vidéo 1920x1080

**Résultat :**

<img src="docs/images/example-smpte-test-pattern.png" width="720" alt="Mire de test de barres colorées SMPTE générée par Claude via illustrator-mcp-server" />

**Structure du plan de travail** (via `get_document_structure`) :

<details>
<summary>Cliquez pour déployer</summary>

```
Labels
├── title-safe-label        (text)    — "TITLE SAFE (10%)"
├── action-safe-label       (text)    — "ACTION SAFE (5%)"
├── credit-label            (text)    — "Generated by illustrator-mcp-server"
├── test-label              (text)    — "SMPTE COLOR BARS — TEST PATTERN"
├── format-label            (text)    — "Full HD — 16:9"
└── resolution-label        (text)    — "1920 x 1080"

Center Cross
├── title-safe              (path)    — 1536×864 stroke rectangle
├── action-safe             (path)    — 1728×972 stroke rectangle
├── cross-circle            (path)    — 150×150 center circle
├── cross-v                 (path)    — vertical crosshair
└── cross-h                 (path)    — horizontal crosshair

Color Bars
├── pluge-black … pluge-navy   (path ×9)  — PLUGE / grayscale bottom strip
├── rev-white … rev-blue       (path ×7)  — reverse color middle strip
└── bar-white … bar-blue       (path ×7)  — 75% SMPTE color bars
```

</details>

> Outils utilisés : `create_document`, `manage_layers`, `create_rectangle` ×23, `create_line` ×2, `create_ellipse`, `create_text_frame` ×6, `modify_object` ×4, `save_document`, `export`

---

## Exemple : Twilight Geometry

Une œuvre abstraite de paysage géométrique — créée entièrement par Claude, sans autre direction artistique humaine que « fais l'œuvre que tu veux ».

**Prompt :**

> Fais une œuvre d'art de ta propre imagination dans Illustrator. Prends ton temps. Crée ce que tu veux.

**Démarche de Claude :**

> Je vais créer « Twilight Geometry » — un paysage abstrait avec des éléments célestes géométriques. Un ciel crépusculaire en dégradé profond, des silhouettes de montagnes en couches, un croissant de lune avec des anneaux décoratifs, et des étoiles parsemées sur le canevas.

> Des étoiles en forme de losange de différentes couleurs — blancs chauds, bleus froids, violets lavande — chacune subtilement différente pour suggérer différents types d'étoiles. Des lignes de constellation les reliant. Des triangles filaires et un hexagone flottant dans le ciel pour une atmosphère mystique.

> Une surface d'eau au bas avec la lumière de la lune reflétée en lignes ondulantes scintillantes, s'estompant à mesure qu'elles descendent.

**Réflexion de Claude :**

> Le résultat est meilleur que prévu. Je pense que le monde hybride de la géométrie et de la nature est bien ressorti.

**Résultat :**

<img src="docs/images/example-twilight-geometry.png" width="720" alt="Twilight Geometry — art de paysage géométrique abstrait généré par Claude via illustrator-mcp-server" />

> Outils utilisés : `create_document`, `manage_layers` ×4, `create_rectangle` ×2, `create_gradient` ×2, `create_path` ×11, `create_ellipse` ×14, `create_line` ×4, `create_text_frame` ×2, `modify_object`, `set_z_order`, `export`

---

## Limitations connues

| Limitation | Détails |
|---|---|
| Prise en charge Windows | Windows utilise l'automatisation COM via PowerShell (pas encore testé sur matériel réel) |
| Effets dynamiques | Les paramètres d'ombre portée et d'autres effets peuvent être détectés mais pas lus |
| Profils colorimétriques | Attribution de profil colorimétrique uniquement — la conversion complète n'est pas disponible |
| Réglages de fond perdu | Les réglages de fond perdu ne peuvent pas être lus (limitation de l'API Illustrator) |
| Exportation WebP | Non pris en charge — utilisez PNG ou SVG à la place |
| Traits de coupe japonais | L'exportation PDF génère temporairement les repères dans le document avec la commande TrimMark, exporte, puis les supprime. Documents à un seul plan de travail uniquement — avec plusieurs plans de travail, une erreur est renvoyée |
| Incorporation de polices | Le mode d'incorporation (complet/sous-ensemble) ne peut pas être contrôlé directement — utilisez des préréglages PDF |
| Déclinaisons de taille | Mise à l'échelle proportionnelle uniquement — le texte peut nécessiter un ajustement manuel ensuite |
| Substitution de glyphes dans le texte SVG | Illustrator ne bascule pas glyphe par glyphe vers la police suivante d'une liste `font-family`. Si la première famille est installée mais ne contient pas un glyphe, `import_svg_as_editable` supprime ce caractère sans avertissement et signale tout de même un succès. Utilisez une seule `font-family` par élément de texte et choisissez-en une qui contient les glyphes nécessaires. Une famille *non installée* est remplacée et n'est pas concernée ; `preflight_check` couvre ce cas distinct |
| Notes des objets | Les outils identifient les objets par un UUID stocké dans la note de chaque objet (panneau Options d'objet). Une note que vous avez écrite est conservée — l'UUID est ajouté devant |

---

<br>

# Pour les développeurs

## Architecture

```mermaid
flowchart LR
    Claude <-->|MCP Protocol| Server["MCP Server\n(TypeScript/Node.js)"]

    Server -.->|generate| Runner["run-{uuid}.scpt / .ps1"]
    Server -.->|generate| JSX["script-{uuid}.jsx\n(BOM UTF-8)"]
    Server -.->|write| PF["params-{uuid}.json"]

    Runner -->|execFile| osascript
    Runner -->|execFile| PS["powershell.exe"]

    osascript -->|do javascript| AI["Adobe Illustrator\n(ExtendScript/JSX)"]
    PS -->|DoJavaScript| AI

    JSX -.->|execute| AI
    PF -.->|read| AI
    AI -.->|write| RF["result-{uuid}.json"]
    RF -.->|read| Server
```

---

## Compilation depuis les sources

```bash
git clone https://github.com/ie3jp/illustrator-mcp-server.git
cd illustrator-mcp-server
npm install
npm run build
claude mcp add illustrator-mcp -- node /path/to/illustrator-mcp-server/dist/index.js
```

### Vérification

```bash
npx @modelcontextprotocol/inspector npx illustrator-mcp-server
```

### Tests

```bash
# Tests unitaires
npm test

# Test E2E de fumée (nécessite qu'Illustrator soit lancé)
npm run build   # E2E runs dist/index.js
npx tsx test/e2e/e2e-test.ts        # every tool (193 cases)
npx tsx test/e2e/e2e-behaviors.ts   # behavior & regression checks (92 cases)
npx tsx test/e2e/e2e-cmyk-only.ts
npx tsx test/e2e/svg-import-test.ts
```

Les suites E2E créent leurs propres documents, ne touchent pas aux autres documents ouverts et les ferment sans enregistrer. `e2e-test.ts` exécute tous les outils enregistrés (RVB + CMJN, détection automatique du système de coordonnées) ; `e2e-behaviors.ts` vérifie les comportements qui doivent tenir dans l'application réelle : les notes sont conservées, les échecs partiels sont signalés, les fichiers ne sont pas écrasés, les traits de coupe et l'export PDF laissent votre illustration intacte.

---

## Avertissement

Cet outil automatise de nombreuses opérations Illustrator, mais l'IA peut faire des erreurs. Les données extraites, les résultats de preflight et les modifications de document doivent toujours être relus par une personne. **Ne vous reposez pas sur cet outil comme seule vérification qualité.** Utilisez-le comme un assistant aux côtés de votre propre vérification manuelle, en particulier pour les remises à l'imprimeur et les livrables clients. Les auteurs ne sauraient être tenus responsables des dommages ou pertes résultant de l'utilisation de ce logiciel ou de ses sorties.

---

## Licence

[MIT](LICENSE)
