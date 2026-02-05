import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const supabase = createClient(
  'https://bxoqhmfnseskwqkywppg.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4b3FobWZuc2Vza3dxa3l3cHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5Mjk4MzgsImV4cCI6MjA3NjUwNTgzOH0.vnzlMkgkA0bOpFSw2JN_b3GjrxWK3S85yC1WGeoOUZc'
);

export let currentUserId = null;
let currentFolder = 'inbox';
let threads = [];
let activeRootId = null;

/* =====================
   INIT
===================== */
export async function initMessaging() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  currentUserId = session.user.id;
  await loadFolder('inbox');
}

/* =====================
   LOAD FOLDER
===================== */
export async function loadFolder(folder) {
  currentFolder = folder;

  const list = document.getElementById('conversationList');
  if (list) list.innerHTML = '<p class="text-gray-400 p-4">Loading…</p>';

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('owner_id', currentUserId)
    .eq('folder', folder)
    .order('created_at', { ascending: false });

  if (error) {
    if (list) list.innerHTML = '<p class="text-red-400 p-4">Failed to load messages</p>';
    console.error(error);
    return;
  }

  buildThreads(data || []);
  renderConversationList();
  updateInboxCount(data || []);
}

/* =====================
   BUILD THREADS
===================== */
function buildThreads(messages) {
  const map = {};

  messages.forEach(m => {
    const rootId = m.parent_id || m.id;
    if (!map[rootId]) map[rootId] = [];
    map[rootId].push(m);
  });

  threads = Object.entries(map).map(([rootId, msgs]) => {
    msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return {
      rootId,
      messages: msgs,
      latest: msgs[msgs.length - 1]
    };
  });

  threads.sort((a, b) =>
    new Date(b.latest.created_at) - new Date(a.latest.created_at)
  );
}

/* =====================
   RENDER CONVERSATION LIST
===================== */
function renderConversationList() {
  const list = document.getElementById('conversationList');
  if (!list) return;

  list.innerHTML = '';

  if (!threads.length) {
    list.innerHTML = '<p class="text-gray-400 text-center mt-6">No messages</p>';
    return;
  }

  threads.forEach(thread => {
    const unread =
      thread.latest.receiver_id === currentUserId &&
      !thread.latest.read_at;

    const div = document.createElement('div');
    div.className = `
      p-4 border-b border-gray-800 cursor-pointer
      ${unread ? 'font-extrabold' : ''}
    `;

    div.onclick = () => openConversation(thread.rootId);

    div.innerHTML = `
      <p class="font-bold">${thread.latest.subject || 'Conversation'}</p>
      <p class="text-gray-400 truncate">${thread.latest.body}</p>
    `;

    list.appendChild(div);
  });
}

/* =====================
   OPEN CONVERSATION
===================== */
export async function openConversation(rootId) {
  activeRootId = rootId;
  const thread = threads.find(t => t.rootId === rootId);
  if (!thread) return;

  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('receiver_id', currentUserId)
    .eq('parent_id', rootId)
    .is('read_at', null);

  let html = '';
  thread.messages.forEach(m => {
    html += `
      <div class="mb-4 p-4 rounded-xl bg-black/30">
        <p class="font-bold">
          ${m.sender_id === currentUserId ? 'You' : 'Them'}
        </p>
        <p>${m.body}</p>
      </div>
    `;
  });

  html += `
    <button onclick="openReply()" 
      class="mt-6 bg-emerald-600 px-6 py-3 rounded-xl font-bold">
      Reply
    </button>
  `;

  const view = document.getElementById('messageView');
  if (view) view.innerHTML = html;

  await loadFolder(currentFolder);
}

/* =====================
   INBOX COUNT
===================== */
function updateInboxCount(messages) {
  const badge = document.getElementById('inboxCount');
  if (!badge) return;

  const unread = messages.filter(
    m => m.receiver_id === currentUserId && !m.read_at
  ).length;

  badge.textContent = unread;
  badge.classList.toggle('hidden', unread === 0);
}

/* =====================
   SEND REPLY
===================== */
export async function sendReply(text) {
  if (!activeRootId) return;

  const thread = threads.find(t => t.rootId === activeRootId);
  if (!thread) return;

  const root = thread.messages[0];
  const receiverId =
    root.sender_id === currentUserId
      ? root.receiver_id
      : root.sender_id;

  await supabase.from('messages').insert([
    {
      sender_id: currentUserId,
      receiver_id: receiverId,
      owner_id: currentUserId,
      folder: 'sent',
      parent_id: activeRootId,
      body: text
    },
    {
      sender_id: currentUserId,
      receiver_id: receiverId,
      owner_id: receiverId,
      folder: 'inbox',
      parent_id: activeRootId,
      body: text
    }
  ]);

  await loadFolder(currentFolder);
}