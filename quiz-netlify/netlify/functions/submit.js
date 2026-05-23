exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const SYSTEME_API_KEY = process.env.SYSTEME_API_KEY;
  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE = "Réponses quiz";

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { prenom, email, tel, answers, diagnostic } = data;

  // ── 1. SYSTEME.IO ──────────────────────────────────────────────────────────
  let tagIds = [];
  try {
    const tagsRes = await fetch("https://api.systeme.io/api/tags?limit=100", {
      headers: {
        "X-API-Key": SYSTEME_API_KEY,
        "Content-Type": "application/json"
      }
    });
    const tagsData = await tagsRes.json();
    const tagNames = ["Téléchargement du bonus", "Toute ma liste"];
    if (tagsData.items) {
      tagsData.items.forEach(t => {
        if (tagNames.includes(t.name)) tagIds.push({ id: t.id });
      });
    }
  } catch(e) {
    console.error("Erreur récupération tags Systeme.io:", e);
  }

  try {
    const fields = [
      { slug: "first_name", value: prenom || "" },
      { slug: "phone_number", value: tel || "" },
      { slug: "diagnostic_quiz", value: diagnostic || "" }
    ];
    await fetch("https://api.systeme.io/api/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": SYSTEME_API_KEY
      },
      body: JSON.stringify({ email, fields, tags: tagIds })
    });
  } catch(e) {
    console.error("Erreur envoi Systeme.io:", e);
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
  const q5Labels = ["30 min ou moins", "30 min à 1h", "1h à 2h", "Plus de 2h"];
  const q6Labels = ["Personnages originaux", "Portraits expressifs", "Créatures et animaux", "Illustrations perso/pro", "Fanarts"];
  const q7Labels = ["Réaliste / semi-réaliste", "Stylisé / manga / cartoon", "J'explore !"];

  const airtableRecord = {
    fields: {
      "Prénom": prenom || "",
      "Email": email || "",
      "Téléphone": tel || "",
      "Date": new Date().toISOString(),
      "Q1 - Niveau actuel": answers.q1 !== undefined ? niveauLabels[answers.q1] : "",
      "Q2 - Blocages cochés": (answers.q2 || []).map(i => q2Labels[i]).join(", "),
      "Q2 - Précision libre": answers.q2_open || "",
      "Q3 - Régularité": answers.q3 !== undefined ? q3Labels[answers.q3] : "",
      "Q4 - Rapport à l'erreur": answers.q4 !== undefined ? q4Labels[answers.q4] : "",
      "Q5 - Disponibilité": answers.q5 !== undefined ? q5Labels[answers.q5] : "",
      "Q6 - Objectifs dessin": (answers.q6 || []).map(i => q6Labels[i]).join(", "),
      "Q7 - Style visé": answers.q7 !== undefined ? q7Labels[answers.q7] : "",
      "Q8 - Ressenti dans 1 an": answers.q8 || "",
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
    if (!atRes.ok) {
      const err = await atRes.text();
      console.error("Erreur Airtable:", err);
    }
  } catch(e) {
    console.error("Erreur envoi Airtable:", e);
  }

  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ success: true })
  };
};
