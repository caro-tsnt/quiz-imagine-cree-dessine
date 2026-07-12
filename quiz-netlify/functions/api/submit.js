// Cloudflare Pages Function — route automatique : /api/submit
// Emplacement dans le repo : functions/api/submit.js
// Variables d'environnement à définir dans Cloudflare Pages (Settings → Environment variables) :
//   SYSTEME_API_KEY, AIRTABLE_TOKEN, AIRTABLE_BASE_ID

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Pré-vol CORS
export async function onRequestOptions() {
  return new Response("", { status: 200, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const SYSTEME_API_KEY = env.SYSTEME_API_KEY;
  const AIRTABLE_TOKEN  = env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE = "Réponses quiz";
  // En-tete navigateur : sans lui, le CloudFront de Systeme.io renvoie 403
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  // ⚑ Marqueur de version : si tu vois cette ligne dans les logs Cloudflare,
  // c'est que la BONNE version (tags d'archétype) est bien en ligne.
  console.log("=== submit.js VERSION 2026-07-12-D (limite 255 caractères Systeme.io) ===");

  let data;
  try {
    data = await request.json();
  } catch (e) {
    return new Response("Invalid JSON", { status: 400, headers: CORS });
  }

  const { prenom, email, tel, answers, diagnostic } = data;
  const safeAnswers = answers || {};

  // ── Détection de l'archétype (pour router le bon mail J0) ───────────────────
  // Le diagnostic contient un marqueur du type "|Archétype:NomDuProfil".
  // On en extrait le profil, puis on le mappe vers un tag Systeme.io.
  // Matching souple sur un mot-clé pour tolérer accents, points médians et espaces.
  let archetypeTag = "";
  const archMatch = (diagnostic || "").match(/\|\s*Arch[ée]type\s*:\s*([^|]+)/i);
  if (archMatch) {
    const a = archMatch[1].toLowerCase();
    if (a.includes("perfectionniste"))      archetypeTag = "Quiz - Visionnaire";
    else if (a.includes("dispers"))         archetypeTag = "Quiz - Explorateur";
    else if (a.includes("plafond"))         archetypeTag = "Quiz - Plafond de verre";
  }
  console.log("Archétype détecté → tag:", archetypeTag || "(aucun)");

  // ── Extraction du plan personnalisé (pour les variables du mail J0) ─────────
  // Le diagnostic est de la forme "Clé:Valeur|Clé:Valeur|..."
  // Exemple : "Niveau:Débutant·e|...|PremierCap:3 semaines|Estimation:~1 an|Archétype:..."
  // On en extrait les valeurs utiles, envoyées ensuite comme champs personnalisés
  // Systeme.io pour être insérées dans le mail J0.
  const plan = {};
  (diagnostic || "").split("|").forEach(part => {
    const idx = part.indexOf(":");
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (value) plan[key] = value;
    }
  });
  // "~1 an" → "1 an" : le "~" ferait doublon avec le mot "environ" dans le mail
  const cleanTilde = v => (v || "").replace(/^~\s*/, "");
  const estimationQuiz = cleanTilde(plan["Estimation"]);
  const premierCapQuiz = cleanTilde(plan["PremierCap"]);
  console.log("Plan extrait:", JSON.stringify(plan));

  // ── 1. SYSTEME.IO ──────────────────────────────────────────────────────────
  try {
    // Récupérer les tags
    const tagsRes = await fetch("https://api.systeme.io/api/tags?limit=100", {
      headers: { "X-API-Key": SYSTEME_API_KEY, "Content-Type": "application/json", "User-Agent": UA }
    });
    const tagsData = await tagsRes.json();
    console.log("Tags disponibles:", JSON.stringify(tagsData));

    // "A fait le quiz" declenche la sequence de suivi quiz (vidéos + masterclass).
    // "Toute ma liste" = liste principale.
    // Le tag d'archétype (si détecté) declenche le bon mail J0 personnalisé.
    // ⚠️ "Telechargement du bonus" a ete RETIRE volontairement : les cadeaux
    // sont reserves aux personnes qui prennent RDV, on applique ce tag manuellement.
    const tagNames = ["A fait le quiz", "Toute ma liste"];
    if (archetypeTag) tagNames.push(archetypeTag);
    let tagIds = [];
    if (tagsData.items) {
      tagsData.items.forEach(t => {
        if (tagNames.includes(t.name)) tagIds.push({ id: t.id });
      });
    }
    console.log("Tags trouvés:", JSON.stringify(tagIds));

    // Champs à mettre à jour.
    // ⚠️ Systeme.io rejette tout le contact (422) si un champ a une valeur vide
    //    OU si une valeur dépasse 255 caractères. On tronque donc tout à 255.
    const clip = v => (v || "").substring(0, 255);
    const fields = [];
    if (prenom && prenom.trim()) fields.push({ slug: "first_name", value: clip(prenom.trim()) });
    if (tel && tel.trim()) fields.push({ slug: "phone_number", value: clip(tel.trim()) });
    const diagValue = clip(diagnostic);
    if (diagValue) fields.push({ slug: "diagnostic_quiz", value: diagValue });

    // Champs du plan personnalisé (variables du mail J0).
    // ⚠️ Ces champs doivent exister dans Systeme.io avec EXACTEMENT ces slugs,
    // sinon l'API renverra une erreur 422. On n'envoie que les valeurs non vides.
    if (estimationQuiz)     fields.push({ slug: "estimation_quiz",  value: clip(estimationQuiz) });
    if (premierCapQuiz)     fields.push({ slug: "premier_cap_quiz", value: clip(premierCapQuiz) });
    if (plan["Niveau"])     fields.push({ slug: "niveau_quiz",      value: clip(plan["Niveau"]) });
    if (plan["Objectif"])   fields.push({ slug: "objectif_quiz",    value: clip(plan["Objectif"]) });

    // Vérifier si le contact existe déjà
    const searchRes = await fetch(
      `https://api.systeme.io/api/contacts?email=${encodeURIComponent(email)}`,
      { headers: { "X-API-Key": SYSTEME_API_KEY, "Content-Type": "application/json", "User-Agent": UA } }
    );
    const searchData = await searchRes.json();
    console.log("Recherche contact existant:", JSON.stringify(searchData));

    const existingContact = searchData.items && searchData.items.length > 0
      ? searchData.items[0]
      : null;

    let contactId;

    if (existingContact) {
      // Contact existant → PATCH pour mettre à jour les champs
      contactId = existingContact.id;
      const patchRes = await fetch(
        `https://api.systeme.io/api/contacts/${contactId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/merge-patch+json", "X-API-Key": SYSTEME_API_KEY, "User-Agent": UA },
          body: JSON.stringify({ fields })
        }
      );
      const patchResult = await patchRes.text();
      console.log("Systeme.io PATCH réponse:", patchRes.status, patchResult);
      if (!patchRes.ok) {
        console.error("⚠️ ÉCHEC PATCH champs Systeme.io ! Statut:", patchRes.status,
          "| Détail:", patchResult,
          "| Champs envoyés:", JSON.stringify(fields));
      }
    } else {
      // Nouveau contact → POST (sans tags dans le body, bug API Systeme.io)
      const postRes = await fetch("https://api.systeme.io/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": SYSTEME_API_KEY, "User-Agent": UA },
        body: JSON.stringify({ email, fields })
      });
      const postData = await postRes.json();
      contactId = postData.id;
      console.log("Systeme.io POST réponse:", postRes.status, JSON.stringify(postData));
      if (!postRes.ok) {
        console.error("⚠️ ÉCHEC POST contact Systeme.io ! Statut:", postRes.status,
          "| Le contact n'a PAS été créé : pas de tags, pas de mail J0.",
          "| Champs envoyés:", JSON.stringify(fields));
      }
    }

    // Appliquer les tags en appels séparés (obligatoire avec l'API Systeme.io)
    if (tagIds.length > 0 && contactId) {
      for (const tag of tagIds) {
        const tagRes = await fetch(
          `https://api.systeme.io/api/contacts/${contactId}/tags`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": SYSTEME_API_KEY, "User-Agent": UA },
            body: JSON.stringify({ tagId: tag.id })
          }
        );
        const tagResult = await tagRes.text();
        console.log(`Tag ${tag.id} appliqué: ${tagRes.status}`, tagResult);
      }
    }

  } catch (e) {
    console.error("Erreur Systeme.io:", e.message);
  }

  // ── 2. AIRTABLE ────────────────────────────────────────────────────────────
  const niveauLabels = [
    "Je ne sais pas par où commencer",
    "Résultat pas du tout ce que j'imaginais",
    "Je reproduis mais pas de tête",
    "Je me débrouille mais ça me frustre"
  ];
  const q2Labels = [
    "Je ne sais pas quoi travailler ni dans quel ordre",
    "J'abandonne en cours de route",
    "Je fais toujours les mêmes erreurs",
    "Je manque de confiance"
  ];
  const q3Labels = ["Rarement ou jamais", "De temps en temps", "1 à 2 fois par semaine", "Régulièrement"];
  const q4Labels = ["Je froisse la feuille", "Je le range sans le montrer", "J'essaie de corriger", "Je rigole et je passe au suivant"];
  // ⚠️ mis à jour pour coller aux nouveaux créneaux de Q5 dans le quiz
  const q5Labels = ["1h ou moins", "Entre 1h et 2h", "Entre 2h et 4h", "Plus de 4h"];
  const q6Labels = ["Personnages originaux", "Portraits expressifs", "Créatures et animaux", "Illustrations perso/pro", "Fanarts"];
  const q7Labels = ["Réaliste / semi-réaliste", "Stylisé / manga / cartoon", "J'explore !"];

  const airtableRecord = {
    fields: {
      "Prénom": prenom || "",
      "Email": email || "",
      "Téléphone": tel || "",
      "Date": new Date().toISOString(),
      "Q1 - Niveau actuel": safeAnswers.q1 !== undefined ? niveauLabels[safeAnswers.q1] : "",
      "Q2 - Blocages cochés": (safeAnswers.q2 || []).map(i => q2Labels[i]).join(", "),
      "Q2 - Précision libre": safeAnswers.q2_open || "",
      "Q3 - Régularité": safeAnswers.q3 !== undefined ? q3Labels[safeAnswers.q3] : "",
      "Q4 - Rapport à l'erreur": safeAnswers.q4 !== undefined ? q4Labels[safeAnswers.q4] : "",
      "Q5 - Disponibilité": safeAnswers.q5 !== undefined ? q5Labels[safeAnswers.q5] : "",
      "Q6 - Objectifs dessin": (safeAnswers.q6 || []).map(i => q6Labels[i]).join(", "),
      "Q7 - Style visé": safeAnswers.q7 !== undefined ? q7Labels[safeAnswers.q7] : "",
      "Q8 - Ressenti dans 1 an": safeAnswers.q8 || "",
      "Diagnostic complet": diagnostic || ""
    }
  };

  try {
    const atRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ records: [airtableRecord] })
      }
    );
    const atResult = await atRes.text();
    console.log("Airtable réponse:", atRes.status, atResult);
  } catch (e) {
    console.error("Erreur Airtable:", e.message);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
