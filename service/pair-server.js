// Small web server that only exists while the TV shows the QR code. The phone opens the page, fills in the details
// and they are passed on to the app. The code in the address means only whoever scanned the QR code can reach the page.
const http = require("http");

const MAX_BODY = 4096;
const TEXT = {
  sv: { title: "Logga in på TV:n", server: "Adress till Home Assistant", user: "Användarnamn", pass: "Lösenord", token: "Långlivad åtkomsttoken",
        useToken: "Använd token i stället", usePass: "Använd lösenord i stället", send: "Skicka till TV:n", sent: "Skickat. Titta på TV:n.",
        again: "Försök igen", failed: "Det gick inte att skicka. Är TV:n fortfarande på inloggningssidan?" },
  en: { title: "Sign in on the TV", server: "Home Assistant address", user: "Username", pass: "Password", token: "Long-lived access token",
        useToken: "Use a token instead", usePass: "Use a password instead", send: "Send to TV", sent: "Sent. Look at the TV.",
        again: "Try again", failed: "Could not send. Is the TV still on the sign-in screen?" },
  de: { title: "Am Fernseher anmelden", server: "Adresse von Home Assistant", user: "Benutzername", pass: "Passwort", token: "Langlebiger Zugriffstoken",
        useToken: "Stattdessen Token verwenden", usePass: "Stattdessen Passwort verwenden", send: "An den Fernseher senden", sent: "Gesendet. Bitte auf den Fernseher schauen.",
        again: "Erneut versuchen", failed: "Senden fehlgeschlagen. Zeigt der Fernseher noch die Anmeldeseite?" },
  fr: { title: "Se connecter sur la TV", server: "Adresse de Home Assistant", user: "Nom d'utilisateur", pass: "Mot de passe", token: "Jeton d'accès longue durée",
        useToken: "Utiliser un jeton", usePass: "Utiliser un mot de passe", send: "Envoyer à la TV", sent: "Envoyé. Regardez la TV.",
        again: "Réessayer", failed: "Envoi impossible. La TV affiche-t-elle toujours l'écran de connexion ?" },
  es: { title: "Iniciar sesión en la TV", server: "Dirección de Home Assistant", user: "Usuario", pass: "Contraseña", token: "Token de acceso de larga duración",
        useToken: "Usar un token", usePass: "Usar una contraseña", send: "Enviar a la TV", sent: "Enviado. Mira la TV.",
        again: "Intentar de nuevo", failed: "No se pudo enviar. ¿Sigue la TV en la pantalla de inicio de sesión?" },
  it: { title: "Accedi sulla TV", server: "Indirizzo di Home Assistant", user: "Nome utente", pass: "Password", token: "Token di accesso a lunga durata",
        useToken: "Usa un token", usePass: "Usa una password", send: "Invia alla TV", sent: "Inviato. Guarda la TV.",
        again: "Riprova", failed: "Invio non riuscito. La TV mostra ancora la schermata di accesso?" },
  nl: { title: "Inloggen op de tv", server: "Adres van Home Assistant", user: "Gebruikersnaam", pass: "Wachtwoord", token: "Langdurig toegangstoken",
        useToken: "Gebruik een token", usePass: "Gebruik een wachtwoord", send: "Naar de tv sturen", sent: "Verstuurd. Kijk naar de tv.",
        again: "Opnieuw proberen", failed: "Versturen mislukt. Staat de tv nog op het inlogscherm?" },
  da: { title: "Log ind på tv'et", server: "Adresse til Home Assistant", user: "Brugernavn", pass: "Adgangskode", token: "Langtidsgyldigt adgangstoken",
        useToken: "Brug et token i stedet", usePass: "Brug en adgangskode i stedet", send: "Send til tv'et", sent: "Sendt. Kig på tv'et.",
        again: "Prøv igen", failed: "Kunne ikke sende. Viser tv'et stadig loginsiden?" },
  nb: { title: "Logg inn på TV-en", server: "Adresse til Home Assistant", user: "Brukernavn", pass: "Passord", token: "Langvarig tilgangstoken",
        useToken: "Bruk et token i stedet", usePass: "Bruk et passord i stedet", send: "Send til TV-en", sent: "Sendt. Se på TV-en.",
        again: "Prøv igjen", failed: "Kunne ikke sende. Viser TV-en fortsatt innloggingssiden?" },
  fi: { title: "Kirjaudu televisioon", server: "Home Assistantin osoite", user: "Käyttäjätunnus", pass: "Salasana", token: "Pitkäaikainen käyttöoikeustunnus",
        useToken: "Käytä tunnusta", usePass: "Käytä salasanaa", send: "Lähetä televisioon", sent: "Lähetetty. Katso televisiota.",
        again: "Yritä uudelleen", failed: "Lähetys epäonnistui. Onko televisio yhä kirjautumissivulla?" },
  pl: { title: "Zaloguj się na telewizorze", server: "Adres Home Assistant", user: "Nazwa użytkownika", pass: "Hasło", token: "Długoterminowy token dostępu",
        useToken: "Użyj tokenu", usePass: "Użyj hasła", send: "Wyślij do telewizora", sent: "Wysłano. Spójrz na telewizor.",
        again: "Spróbuj ponownie", failed: "Nie udało się wysłać. Czy telewizor nadal pokazuje ekran logowania?" },
  pt: { title: "Iniciar sessão na TV", server: "Endereço do Home Assistant", user: "Nome de utilizador", pass: "Palavra-passe", token: "Token de acesso de longa duração",
        useToken: "Usar um token", usePass: "Usar uma palavra-passe", send: "Enviar para a TV", sent: "Enviado. Veja a TV.",
        again: "Tentar novamente", failed: "Não foi possível enviar. A TV ainda mostra o ecrã de início de sessão?" },
};

const esc = s => String(s).replace(/[&<>"']/g, c => "&#" + c.charCodeAt(0) + ";");

function page(hint) {
  return `<!DOCTYPE html>
<html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>HomeDash</title>
<style>
  body { margin: 0; padding: 24px; background: #0e1014; color: #e8eaed; font: 17px/1.4 system-ui, sans-serif; }
  form, #done { max-width: 440px; margin: 0 auto; }
  h1 { font-size: 26px; }
  label { display: block; margin: 18px 0 6px; color: #9aa0a6; font-size: 15px; }
  input, textarea, button { box-sizing: border-box; width: 100%; padding: 14px; border: 2px solid #ffffff24; border-radius: 12px;
                            background: #ffffff14; color: #fff; font: inherit; }
  textarea { height: 120px; word-break: break-all; }
  button { margin-top: 26px; border: 0; background: #2f7fd6; font-weight: 600; }
  button.link { margin-top: 12px; background: none; color: #8ab4f8; font-weight: 400; }
  #error { color: #ff8a80; }
  [hidden] { display: none; }
</style>
<form id="form">
  <h1 data-t="title"></h1>
  <label for="url" data-t="server"></label>
  <input id="url" value="${esc(hint)}" placeholder="192.168.1.10" autocapitalize="off" autocorrect="off" spellcheck="false" required>
  <div id="with-pass">
    <label for="username" data-t="user"></label>
    <input id="username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false">
    <label for="password" data-t="pass"></label>
    <input id="password" type="password" autocomplete="current-password">
  </div>
  <div id="with-token" hidden>
    <label for="token" data-t="token"></label>
    <textarea id="token" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
  </div>
  <p id="error"></p>
  <button data-t="send"></button>
  <button type="button" class="link" id="mode" data-t="useToken"></button>
</form>
<div id="done" hidden><h1 data-t="sent"></h1><button type="button" id="again" data-t="again"></button></div>
<script>
  var TEXT = ${JSON.stringify(TEXT)}, L = (navigator.language || "en").split("-")[0].toLowerCase(), T = TEXT[{ nn: "nb", no: "nb" }[L] || L] || TEXT.en, $ = function (id) { return document.getElementById(id); };
  var tokenMode = false;
  function texts() { [].forEach.call(document.querySelectorAll("[data-t]"), function (e) { e.textContent = T[e.getAttribute("data-t")]; }); }
  texts();
  $("mode").onclick = function () {
    tokenMode = !tokenMode;
    $("with-pass").hidden = tokenMode; $("with-token").hidden = !tokenMode;
    $("mode").setAttribute("data-t", tokenMode ? "usePass" : "useToken"); texts();
  };
  $("again").onclick = function () { $("done").hidden = true; $("form").hidden = false; };
  $("form").onsubmit = function (e) {
    e.preventDefault();
    var body = tokenMode ? { url: $("url").value, token: $("token").value.trim() } : { url: $("url").value, username: $("username").value.trim(), password: $("password").value };
    $("error").textContent = "";
    fetch(location.pathname, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw 0; $("password").value = $("token").value = ""; $("form").hidden = true; $("done").hidden = false; })
      .catch(function () { $("error").textContent = T.failed; });
  };
</script>
</html>`;
}

// Returns the credentials if they look sane, otherwise null
function parseCredentials(raw) {
  let b;
  try { b = JSON.parse(raw); } catch (e) { return null; }
  if (!b || typeof b !== "object") return null;
  const str = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
  if (!str(b.url, 200)) return null;
  if (str(b.token, 2000)) return { url: b.url, token: b.token };
  if (str(b.username, 200) && str(b.password, 500)) return { url: b.url, username: b.username, password: b.password };
  return null;
}

function createPairServer(code, hint, onCredentials) {
  return http.createServer((req, res) => {
    const send = (status, type, body) => { res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(body); };
    if (req.url !== "/" + code) return send(404, "text/plain", "Not found");
    if (req.method === "GET") return send(200, "text/html; charset=utf-8", page(hint));
    if (req.method !== "POST") return send(405, "text/plain", "Method not allowed");
    let raw = "", tooBig = false;
    req.on("data", chunk => { raw += chunk; if (raw.length > MAX_BODY) { tooBig = true; raw = ""; } });
    req.on("end", () => {
      if (tooBig) return send(413, "text/plain", "Too large");
      const credentials = parseCredentials(raw);
      if (!credentials) return send(400, "text/plain", "Bad request");
      onCredentials(credentials);
      send(200, "application/json", '{"ok":true}');
    });
  });
}

module.exports = { createPairServer, parseCredentials };
