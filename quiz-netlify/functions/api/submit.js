export async function onRequestPost(context) {
  const { request, env } = context;

  const SYSTEME_API_KEY = env.SYSTEME_API_KEY;
  const AIRTABLE_TOKEN = env.AIRTABLE_TOKEN;
  const AIRTABLE_BASE_ID = env.AIRTABLE_BASE_ID;
  const AIRTABLE_TABLE = "Réponses quiz";

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  let data;
  try {
    data = await request.json();
  } catch(e) {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { prenom, email, tel, answers, diagnostic } = data;

  // ── 1. SYSTEME.IO ──────────────────────────────────────────────────────────
  try {
    const tagsRes = await fetch("https://api.systeme.io/api/tags?limit=100", {
      headers: {
        "X-API-Key": SYSTEME_API_KEY,
        "Content-Type": "application/json"
      }
    });
    const tagsData = await tagsRes.json();

    const tagNames = ["Téléchargement du bonus", "Toute ma liste"];
    let tagIds = [];
    if (tagsData.items) {
      tagsData.items.forEach(t => {
        if (tagNames.includes(t.name)) tagIds.push({ id: t.id });
      });
    }

    const fields = [
      { slug: "first_name", value: prenom || "" },
      { slug: "phone_number", value: tel || "" },
      { slug: "diagnostic_quiz", value: (diagnostic || "").substring(0, 500) }
    ];

    const searchRes = await fetch(
      `https://api.systeme.io/api/contacts?email=${encodeURIComponent(email)}`,
      {
        headers: {
          "X-API-Key": SYSTEME_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );
    const searchData = await searchRes.json();

    const existingContact = searchData.items && searchData.items.length > 0
      ? searchData.items[0]
      : null;

    let contactId;

    if (existingContact) {
      contactId = existingContact.id;
      await fetch(`https://api.systeme.io/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": SYSTEME_API_KEY
        },
        body: JSON.stringify({ fields })
      });
    } else {
      const postRes = await fetch("https://api.systeme.io/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": SYSTEME_API_KEY
        },
        body: JSON.stringify({ email, fields })
      });
      const postData = await postRes.json();
      contactId = postData.id;
    }

    if (tagIds.length > 0 && contactId) {
      for (const tag of tagIds) {
        await fetch(`https://api.systeme.io/api/contacts/${contactId}/tags`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": SYSTEME_API_KEY
          },
          body: JSON.stringify({ tagId: tag.id })
        });
      }
    }

  } catch(e) {
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
    await fetch(
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
  } catch(e) {
    console.error("Erreur Airtable:", e.message);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: corsHeaders
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    }
  });
}
