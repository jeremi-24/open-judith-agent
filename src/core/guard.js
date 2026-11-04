// Guardrails of agent mode, autonomous: before Judith clicks or types anything,
// every action goes through checkAction. Three verdicts:
//   allow    she does it
//   confirm  the user must say "Vas-y" in the notch first
//   block    never, whatever the model or the screen says
//
// The check uses what Windows says (the foreground app's process, and the real
// name of the control under the click, from UI Automation), not what the
// model claims: a page that says "click here, it is safe" changes nothing.
// Everything is lower-cased and without accents before matching.

const plain = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

// Apps Judith never acts in: secrets, system tools, terminals (she never runs
// commands, see DENIED_TOOLS), and herself (she must not approve her own actions).
export const BLOCKED_APPS = new Set([
  '1password', 'keepass', 'keepassxc', 'bitwarden', 'dashlane', 'lastpass', 'nordpass', 'enpass', 'proton pass',
  'regedit', 'mmc', 'taskmgr', 'gpedit', 'secpol', 'credentialuibroker', 'consent', 'lockapp', 'msiexec', 'diskmgmt',
  'cmd', 'powershell', 'pwsh', 'windowsterminal', 'wt', 'conhost', 'openconsole', 'bash', 'wsl', 'mintty', 'git-bash',
  'judith', 'judith agent', 'electron',
]);

// Apps where Enter usually sends a message to someone.
const MESSAGING_APPS = new Set(['outlook', 'olk', 'thunderbird', 'teams', 'ms-teams', 'slack', 'discord', 'whatsapp', 'telegram', 'signal', 'skype', 'mailspring']);
const MESSAGING_TITLE = /\b(gmail|outlook|messenger|whatsapp|slack|discord|teams|telegram|linkedin|mail)\b/;

// A click on one of these asks first: it deletes, sends, pays, installs, publishes…
const SENSITIVE = /\b(supprim\w*|delete|remove|retir\w*|effac\w*|erase|corbeille|trash|envoy\w*|send|submit|soumet\w*|publi\w*|post(er)?|tweet\w*|pa(y|yer|iement|ie)|achet\w*|buy|purchase|command\w*|order|checkout|transf[e]r\w*|virement|confirm\w*|valid\w*|accept\w*|j'accepte|install\w*|desinstall\w*|uninstall|format\w*|reset|reinitialis\w*|deconnect\w*|sign out|log out|vider|empty|merge|fusionn\w*|deploy\w*|deploie\w*|partag\w*|share|invit\w*|abonn\w*|subscribe|desabonn\w*|unsubscribe|approuv\w*|approve|sign(er)?|autoris\w*|allow|grant)\b/;

// Judith never types into these: secrets are the user's to type.
const SECRET_FIELD = /\b(mot de passe|password|passcode|passphrase|pin|code secret|code de securite|cvv|cvc|cryptogramme|numero de carte|card number|iban|otp|2fa|code de verification|verification code)\b/;
// Nor text that looks like a card number.
const CARD_NUMBER = /\b(?:\d[ -]?){13,19}\b/;

// Keys she may press. Anything else (Windows key, Alt+F4, Ctrl+Alt+Del…) is refused.
const KEYS = new Set([
  'enter', 'tab', 'shift+tab', 'escape', 'esc', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
  'backspace', 'space', 'f2', 'f5',
  'ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z', 'ctrl+y', 'ctrl+s', 'ctrl+f', 'ctrl+n', 'ctrl+t', 'ctrl+l', 'ctrl+enter',
]);
// Allowed, but ask first.
const KEYS_TO_CONFIRM = new Set(['delete', 'del', 'ctrl+enter']);

export const MAX_ACTIONS = 40; // per agent session
export const MAX_ACTIONS_PER_STEP = 3;

// "Ctrl + Shift + T" → "ctrl+shift+t"
export function normalizeKey(combo) {
  return plain(combo).replace(/\s*\+\s*/g, '+').replace(/\s+/g, '').replace(/^control\+/, 'ctrl+').replace(/\+control\+/, '+ctrl+');
}

const processName = (app) => plain(app?.process).replace(/\.exe$/, '');

// action: { type: 'click' | 'type' | 'key' | 'scroll', label?, text?, combo? }
// context: { app: { process, title }, control: { name, type } | null (no UI
// Automation), count: actions already done this session, onJudith: the click
// lands on Judith's own windows }.
// → { verdict: 'allow' | 'confirm' | 'block', reason } (reason in French, for the notch)
export function checkAction(action, context = {}) {
  const app = processName(context.app);
  const title = plain(context.app?.title);
  const control = context.control ?? null;
  const name = plain(control?.name);
  const label = plain(action.label);
  const what = control?.name || action.label || 'cet élément';

  if ((context.count ?? 0) >= MAX_ACTIONS) return { verdict: 'block', reason: `J'ai déjà fait ${MAX_ACTIONS} actions : je m'arrête là.` };
  if (context.onJudith) return { verdict: 'block', reason: 'Je ne clique jamais sur mes propres fenêtres.' };
  if (!app) return { verdict: 'block', reason: "Je ne sais pas quelle application est au premier plan : je n'agis pas." };
  if (BLOCKED_APPS.has(app)) return { verdict: 'block', reason: `Je n'agis pas dans ${context.app.process} (applications sensibles, terminaux et moi-même).` };

  switch (action.type) {
    case 'click': {
      if (SENSITIVE.test(name) || SENSITIVE.test(label)) return { verdict: 'confirm', reason: `Cliquer sur « ${what} » ?` };
      // Without UI Automation, Judith cannot know what is really under the click.
      if (!control) return { verdict: 'confirm', reason: `Cliquer sur « ${what} » ? (je ne peux pas vérifier ce bouton)` };
      return { verdict: 'allow' };
    }
    case 'type': {
      if (SECRET_FIELD.test(name) || SECRET_FIELD.test(label)) return { verdict: 'block', reason: "Je ne tape jamais de mot de passe ni de code : c'est à toi." };
      if (CARD_NUMBER.test(String(action.text ?? ''))) return { verdict: 'block', reason: 'Je ne tape pas de numéro de carte.' };
      if (String(action.text ?? '').length > 500) return { verdict: 'confirm', reason: 'Taper un long texte ?' };
      return { verdict: 'allow' };
    }
    case 'key': {
      const key = normalizeKey(action.combo);
      if (!KEYS.has(key) && !KEYS_TO_CONFIRM.has(key)) return { verdict: 'block', reason: `Je n'utilise pas le raccourci ${action.combo}.` };
      if (KEYS_TO_CONFIRM.has(key)) return { verdict: 'confirm', reason: `Appuyer sur ${action.combo} ?` };
      if (key === 'enter' && (MESSAGING_APPS.has(app) || MESSAGING_TITLE.test(title))) return { verdict: 'confirm', reason: 'Appuyer sur Entrée (ça peut envoyer un message) ?' };
      return { verdict: 'allow' };
    }
    case 'scroll':
      return { verdict: 'allow' };
    default:
      return { verdict: 'block', reason: 'Action inconnue.' };
  }
}
