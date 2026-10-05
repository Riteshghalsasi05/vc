(() => {
  const config = window.MEADOW_CONFIG || {};
  const loginAccounts = [
    { email: (config.adminEmail || '').trim().toLowerCase(), role: 'admin' },
    { email: 'student-demo@gmail.com', role: 'student' },
    { email: 'teacher-demo@gmail.com', role: 'teacher' }
  ].filter(account => account.email);
  const client = config.supabaseUrl && config.supabaseAnonKey && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;
  const views = {
    home: document.querySelector('#home-view'),
    login: document.querySelector('#login-view'),
    app: document.querySelector('#app-view')
  };
  const content = document.querySelector('#page-content');
  const nav = document.querySelector('#side-nav');
  let user = null;
  let profile = null;
  let roleChoice = 'student';
  let subjectsCache = [];
  let pageGeneration = 0;

  const navigation = {
    student: [
      ['dashboard', 'â–¦', 'Dashboard'], ['subjects', 'â–¤', 'My Subjects'],
      ['videos', 'â–·', 'Recorded Videos'], ['notes', 'â–§', 'Notes'],
      ['tests', 'âœ“', 'Mock Tests'], ['assignments', 'â˜·', 'Assignments'], ['profile', 'â™™', 'Profile']
    ],
    teacher: [
      ['dashboard', 'â–¦', 'Dashboard'], ['subjects', 'â–¤', 'Subjects'],
      ['upload-videos', 'â–·', 'Upload Videos'], ['upload-notes', 'â–§', 'Upload Notes'],
      ['create-test', 'âœ“', 'Create Mock Test'], ['assignments', 'â˜·', 'Assignments'],
      ['students', 'â™™', 'Students'], ['profile', 'â™™', 'Profile']
    ],
    admin: [
      ['dashboard', 'â–¦', 'Dashboard'], ['people', 'â™™', 'Students & Teachers'],
      ['subjects', 'â–¤', 'Subjects'], ['profile', 'â™™', 'Profile']
    ]
  };

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function showView(name) {
    Object.entries(views).forEach(([key, element]) => { element.hidden = key !== name; });
  }

  function setLoginRole(role) {
    roleChoice = role;
    document.querySelectorAll('.login-role[data-role]').forEach(button => {
      button.classList.toggle('active', button.dataset.role === role);
    });
  }

  function openLogin(role = 'student') {
    setLoginRole(role);
    document.querySelector('#login-form').reset();
    const password = document.querySelector('#login-password');
    const passwordLabel = document.querySelector('label[for="login-password"]');
    password.required = true;
    password.hidden = false;
    passwordLabel.hidden = false;
    const account = loginAccounts.find(item => item.role === role);
    document.querySelector('#login-email').value = account ? account.email : '';
    document.querySelector('#login-password').value = '';
    document.querySelector('#login-message').textContent = client ? 'Sign in with the password set for this Supabase Auth account.' : 'Add the Supabase URL and anon key to config.js to connect sign in.';
    showView('login');
  }

  function announce(message, success = false) {
    const box = document.querySelector('#page-notice');
    if (!box) return;
    box.textContent = message;
    box.className = `notice${success ? ' success' : ''}`;
    box.hidden = !message;
  }

  async function checked(result) {
    if (result.error) throw result.error;
    return result.data;
  }

  async function loadProfile(currentUser) {
    const data = await checked(client.from('profiles').select('*').eq('id', currentUser.id).maybeSingle());
    if (!data) throw new Error('Signed in, but this app cannot read the matching public.profiles row. Check that the profile id matches this Auth user and that authenticated users have SELECT permission under the profiles RLS policy. Your session is kept.');
    if (!['student', 'teacher', 'admin'].includes(data.role)) throw new Error('This account has no valid classroom role. Ask your administrator for access.');
    if (data.account_status === 'suspended') throw new Error('This classroom account is not active. Contact your administrator.');
    if (data.role === 'admin' && currentUser.email?.toLowerCase() !== (config.adminEmail || '').toLowerCase()) {
      throw new Error('This account is not the configured classroom administrator.');
    }
    return data;
  }

  async function enterClassroom(currentUser, userProfile) {
    user = currentUser;
    profile = userProfile;
    subjectsCache = [];
    document.querySelector('#sidebar-role').textContent = `${profile.role[0].toUpperCase()}${profile.role.slice(1)} Portal`;
    document.querySelector('#user-name').textContent = profile.full_name;
    document.querySelector('#user-role').textContent = profile.role[0].toUpperCase() + profile.role.slice(1);
    document.querySelector('#header-role').textContent = profile.role[0].toUpperCase() + profile.role.slice(1);
    document.querySelector('#user-initials').textContent = profile.full_name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    nav.innerHTML = navigation[profile.role].map(([id, icon, label]) => `<button class="nav-item" data-nav="${id}"><span>${icon}</span>${label}</button>`).join('');
    showView('app');
    await go('dashboard');
  }

  async function subjectList(force = false) {
    if (!force && subjectsCache.length) return subjectsCache;
    if (profile.role === 'teacher') {
      subjectsCache = await checked(client.from('subjects').select('*').eq('teacher_id', user.id).order('name'));
    } else if (profile.role === 'student') {
      const rows = await checked(client.from('subject_memberships').select('subject_id').eq('student_id', user.id));
      const ids = rows.map(row => row.subject_id);
      subjectsCache = ids.length ? await checked(client.from('subjects').select('*').in('id', ids).order('name')) : [];
    } else {
      subjectsCache = await checked(client.from('subjects').select('*').order('name'));
    }
    return subjectsCache;
  }

  function subjectOptions(subjects, selected = '') {
    return `<option value="">Choose a subject</option>${subjects.map(subject => `<option value="${subject.id}" ${selected === subject.id ? 'selected' : ''}>${escapeHtml(subject.name)}${subject.code ? ` Â· ${escapeHtml(subject.code)}` : ''}</option>`).join('')}`;
  }

  function formNotice() {
    return '<p id="page-notice" class="notice" role="status" hidden></p>';
  }

  function shell(title, intro, body) {
    document.querySelector('#page-title').textContent = title;
    content.innerHTML = `${formNotice()}${intro ? `<p class="page-intro">${intro}</p>` : ''}${body}`;
  }

  function empty(text) { return `<div class="empty-state"><span>âœ¿</span><p>${escapeHtml(text)}</p></div>`; }
  function dateText(value) {
    if (!value) return 'No due date';
    return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
  }
  function subjectCard(subject, extra = '') {
    return `<article class="data-card subject-card"><div class="card-symbol">â–¤</div><span class="card-tag">${escapeHtml(subject.code || 'SUBJECT')}</span><h3>${escapeHtml(subject.name)}</h3><p>${escapeHtml(subject.description || 'Subject classroom')}</p><div class="card-meta">${extra}</div></article>`;
  }
  function resourceCard(resource, type) {
    const subjectName = resource.subjects?.name || '';
    const icon = type === 'video' ? 'â–·' : 'PDF';
    return `<article class="resource-row"><span class="resource-icon ${type}">${icon}</span><div class="resource-detail"><h3>${escapeHtml(resource.title)}</h3><p>${escapeHtml(resource.description || subjectName)}${subjectName ? ` Â· ${escapeHtml(subjectName)}` : ''}</p><small>${type === 'video' ? 'Video' : escapeHtml(resource.original_filename)} &nbsp;Â·&nbsp; ${dateText(resource.created_at)}</small></div><button class="small-button" data-file="${escapeHtml(resource.storage_path)}" data-filename="${escapeHtml(resource.original_filename)}" data-resource-id="${escapeHtml(resource.id || '')}" data-resource-type="${type}">${type === 'video' ? 'â–¶ Watch lesson' : 'â†§ Download'}</button></article>`;
  }

  async function go(page) {
    if (!user || !profile) return;
    const allowed = navigation[profile.role].some(([id]) => id === page);
    if (!allowed) page = 'dashboard';
    pageGeneration += 1;
    const generation = pageGeneration;
    nav.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === page));
    try {
      await renderPage(page, generation);
    } catch (error) {
      shell('Something went wrong', '', empty(error.message || 'Could not load this page. Check the database setup and try again.'));
    }
  }

  async function renderPage(page, generation) {
    const subjects = await subjectList();
    if (generation !== pageGeneration) return;
    if (page === 'dashboard') return renderDashboard(subjects);
    if (page === 'subjects') return renderSubjects(subjects);
    if (page === 'videos' || page === 'notes') return renderResources(page === 'videos' ? 'video' : 'note');
    if (page === 'upload-videos' || page === 'upload-notes') return renderUpload(page === 'upload-videos' ? 'video' : 'note', subjects);
    if (page === 'assignments') return renderAssignments(subjects);
    if (page === 'create-test') return renderCreateTest(subjects);
    if (page === 'tests') return renderTests(subjects);
    if (page === 'students') return renderStudents(subjects);
    if (page === 'people') return renderPeople();
    if (page === 'profile') return renderProfile(subjects);
  }

  async function renderDashboard(subjects) {
    const subjectIds = subjects.map(subject => subject.id);
    const [resources, assignments, tests, members, enrollments] = await Promise.all([
      client.from('learning_resources').select('id,resource_type').limit(500),
      client.from('assignments').select('id,title,due_at').order('due_at', { ascending: true }).limit(500),
      client.from('mock_tests').select('id').limit(200),
      profile.role === 'admin' ? client.from('profiles').select('id,role').in('role', ['student','teacher']) : Promise.resolve({ data: [], error: null }),
      profile.role === 'teacher' && subjectIds.length ? client.from('subject_memberships').select('student_id').in('subject_id', subjectIds) : Promise.resolve({ data: [], error: null })
    ]);
    const materialCount = resources.error ? 0 : resources.data.length;
    const assignmentCount = assignments.error ? 0 : assignments.data.length;
    const testCount = tests.error ? 0 : tests.data.length;
    const teacherStudents = new Set((enrollments.data || []).map(item => item.student_id)).size;
    const videosCount = resources.error ? 0 : resources.data.filter(item => item.resource_type === 'video').length;
    const notesCount = resources.error ? 0 : resources.data.filter(item => item.resource_type === 'note').length;
    const cards = profile.role === 'teacher'
      ? [['TOTAL STUDENTS', teacherStudents], ['UPLOADED VIDEOS', videosCount], ['UPLOADED NOTES', notesCount], ['MOCK TESTS', testCount], ['ASSIGNMENTS', assignmentCount]]
      : profile.role === 'admin'
        ? [['SUBJECTS', subjects.length], ['STUDENTS', (members.data || []).filter(item => item.role === 'student').length], ['TEACHERS', (members.data || []).filter(item => item.role === 'teacher').length], ['ASSIGNMENTS', assignmentCount]]
        : [['MY SUBJECTS', subjects.length], ['RECORDED VIDEOS', resources.error ? 'â€”' : resources.data.filter(item => item.resource_type === 'video').length], ['ASSIGNMENTS', assignmentCount], ['MOCK TESTS', testCount]];
    const recent = assignments.data || [];
    const teacherQuickActions = [['upload-videos','Upload Video'],['upload-notes','Upload PDF'],['create-test','Create Mock Test'],['assignments','Create Assignment']];
    const quickActions = profile.role === 'student' ? [['videos','Recorded Videos'],['notes','Notes'],['tests','Mock Tests']] : profile.role === 'teacher' ? teacherQuickActions : [['people','Students & Teachers'],['subjects','Subjects']];
    const heading = profile.role === 'teacher' ? `Welcome, ${escapeHtml(profile.full_name.split(/\s+/)[0])} 👋` : `Welcome back, ${escapeHtml(profile.full_name.split(/\s+/)[0])}.`;
    const teacherIntro = profile.role === 'teacher' ? 'Manage your lessons, notes, mock tests and assignments from here.' : '';
    shell('Dashboard', `${heading}${teacherIntro ? ` ${teacherIntro}` : ''}`, `
      <div class="stats-grid${profile.role === 'teacher' ? ' teacher-dashboard-stats' : ''}">${cards.map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`).join('')}</div>
      <div class="dashboard-columns"><section class="panel"><div class="panel-heading"><div><span class="section-label">YOUR CLASSROOM</span><h2>${profile.role === 'student' ? 'My subjects' : profile.role === 'teacher' ? 'Your subjects' : 'Class subjects'}</h2></div><button class="text-button" data-go="subjects">View all â†’</button></div>${subjects.length ? `<div class="subject-grid">${subjects.slice(0, 4).map(item => subjectCard(item)).join('')}</div>` : empty(profile.role === 'student' ? 'Your teacher has not added you to a subject yet.' : 'No subjects have been created yet.')}</section>
      <section class="panel"><div class="panel-heading"><div><span class="section-label">KEEP ON TRACK</span><h2>Recent assignments</h2></div><button class="text-button" data-go="assignments">View all â†’</button></div>${recent.length ? `<div class="compact-list">${recent.map(row => `<div class="compact-row"><span class="list-dot"></span><span><strong>${escapeHtml(row.title || 'Assignment')}</strong><small>${dateText(row.due_at)}</small></span></div>`).join('')}</div>` : empty('New assignments will appear here.')}</section></div>
      <section class="panel quick-panel"><span class="section-label">${profile.role === 'teacher' ? 'QUICK ACTIONS' : 'QUICK ACCESS'}</span><div class="quick-links${profile.role === 'teacher' ? ' teacher-quick-actions' : ''}">${quickActions.map(([id,label]) => `<button data-go="${id}" class="quick-link">${label}<span>â†’</span></button>`).join('')}</div></section>`);
  }

  async function renderSubjects(subjects) {
    if (profile.role === 'teacher') {
      const ids = subjects.map(subject => subject.id);
      const [materials, tests, assignments] = ids.length ? await Promise.all([
        client.from('learning_resources').select('subject_id,resource_type').in('subject_id', ids),
        client.from('mock_tests').select('subject_id').in('subject_id', ids),
        client.from('assignments').select('subject_id').in('subject_id', ids)
      ]) : [{ data: [] }, { data: [] }, { data: [] }];
      const countFor = (rows, subjectId, type = null) => (rows || []).filter(row => row.subject_id === subjectId && (!type || row.resource_type === type)).length;
      shell('Subjects', 'Manage the subjects in your classroom and add students to each class.', `
        <section class="panel form-panel"><div class="panel-heading"><div><span class="section-label">NEW SUBJECT</span><h2>Create a subject</h2></div></div>
        <form id="subject-form" class="form-grid"><label>Subject name<input name="name" required maxlength="100" placeholder="Mathematics"></label><label>Subject code<input name="code" required maxlength="24" placeholder="MATH-10"></label><label class="full-field">Description<textarea name="description" rows="2" placeholder="A short introduction to this subject"></textarea></label><button class="primary-button" type="submit">+ Create Subject</button></form></section>
        <div class="subject-grid">${subjects.length ? subjects.map(subject => subjectCard(subject, `<div class="subject-stat-row"><span><strong>${countFor(materials.data, subject.id, 'video')}</strong> Videos</span><span><strong>${countFor(materials.data, subject.id, 'note')}</strong> Notes</span><span><strong>${countFor(tests.data, subject.id)}</strong> Mock Tests</span><span><strong>${countFor(assignments.data, subject.id)}</strong> Assignments</span></div><button class="text-button" data-enroll="${subject.id}">Add a student by email â†’</button>`)).join('') : empty('Create your first subject to get started.')}</div>`);
      document.querySelector('#subject-form').addEventListener('submit', createSubject);
      return;
    }
    if (profile.role === 'admin') {
      shell('Subjects', 'Subjects are owned by their teacher and visible to enrolled students.', subjects.length ? `<div class="subject-grid">${subjects.map(subject => subjectCard(subject, 'Class subject')).join('')}</div>` : empty('There are no classroom subjects yet.'));
      return;
    }
    shell('My Subjects', 'Subjects and learning materials shared with your account.', subjects.length ? `<div class="subject-grid">${subjects.map(subject => subjectCard(subject)).join('')}</div>` : empty('Your teacher has not added you to a subject yet.'));
  }

  async function createSubject(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      await checked(client.from('subjects').insert({ name: fields.get('name').trim(), code: fields.get('code').trim().toUpperCase(), description: fields.get('description').trim(), teacher_id: user.id }));
      subjectsCache = [];
      form.reset();
      await go('subjects');
      announce('Subject created.', true);
    } catch (error) { announce(error.message || 'Could not create the subject.'); }
  }

  async function renderUpload(type, subjects) {
    const isVideo = type === 'video';
    const [resources] = await Promise.all([client.from('learning_resources').select('*, subjects(name,code)').eq('resource_type', type).order('created_at', { ascending: false })]);
    const title = isVideo ? 'Upload Recorded Video' : 'Upload Notes';
    const desc = isVideo ? 'Share a recorded lesson with students in your subject.' : 'Upload PDF and document materials for students.';
    const accept = isVideo ? 'video/mp4,video/webm,video/quicktime' : '.pdf,.doc,.docx,image/jpeg,image/png';
    shell(title, desc, `<section class="panel form-panel"><form id="resource-form" class="form-grid"><label>Title<input name="title" required maxlength="150" placeholder="Chapter 2: Introduction"></label><label>Subject<select name="subject_id" required>${subjectOptions(subjects)}</select></label><label class="full-field">Description<textarea name="description" rows="2" placeholder="Add a short description"></textarea></label><label class="file-field full-field">Select ${isVideo ? 'Video' : 'PDF / Document'} File<input name="file" type="file" accept="${accept}" required></label><button class="primary-button" type="submit">â†‘ Upload ${isVideo ? 'Video' : 'Notes'}</button></form></section>
      <section class="panel"><div class="panel-heading"><div><span class="section-label">YOUR CLASSROOM MATERIAL</span><h2>My Uploaded ${isVideo ? 'Videos' : 'Notes'}</h2></div></div>${resources.error ? empty('Could not load classroom materials.') : resources.data.length ? `<div class="resource-list">${resources.data.map(item => resourceCard(item, type)).join('')}</div>` : empty(`No ${isVideo ? 'videos' : 'notes'} have been uploaded yet.`)}</section>`);
    document.querySelector('#resource-form').addEventListener('submit', event => uploadResource(event, type));
  }

  async function renderResources(type) {
    const label = type === 'video' ? 'Recorded Videos' : 'Notes & Study Materials';
    const query = client.from('learning_resources').select('*, subjects(name,code)').eq('resource_type', type).order('created_at', { ascending: false });
    const { data, error } = await query;
    const bySubject = new Map();
    for (const item of data || []) {
      const key = item.subjects?.name || 'Class materials';
      if (!bySubject.has(key)) bySubject.set(key, []);
      bySubject.get(key).push(item);
    }
    const groups = [...bySubject].map(([subject, items]) => `<section class="panel subject-material-panel"><div class="panel-heading"><div><span class="section-label">SUBJECT</span><h2>${escapeHtml(subject)}</h2></div><span class="status-tag">${items.length} ${type === 'video' ? 'lectures' : 'notes'}</span></div><div class="resource-list">${items.map(item => resourceCard(item, type)).join('')}</div></section>`).join('');
    shell(label, type === 'video' ? 'Watch recorded lessons grouped by the subject your teacher shared them with.' : 'Read and download study materials grouped by subject.', error ? empty('Could not load learning materials.') : groups || empty(`Your teachers have not shared ${type === 'video' ? 'recorded videos' : 'notes'} yet.`));
  }

  async function uploadResource(event, type) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get('file');
    try {
      const subjectId = values.get('subject_id');
      const path = `${subjectId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
      await checked(client.storage.from('classroom-files').upload(path, file, { contentType: file.type, upsert: false }));
      try {
        await checked(client.from('learning_resources').insert({ subject_id: subjectId, created_by: user.id, resource_type: type, title: values.get('title').trim(), description: values.get('description').trim(), storage_path: path, original_filename: file.name, mime_type: file.type || 'application/octet-stream' }));
      } catch (error) {
        await client.storage.from('classroom-files').remove([path]);
        throw error;
      }
      form.reset();
      await renderUpload(type, await subjectList(true));
      announce('Your file has been uploaded.', true);
    } catch (error) { announce(error.message || 'Upload failed. Check the file type, size and storage policies.'); }
  }

  function safeFilename(name) {
    return name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-100) || 'classroom-file';
  }

  async function openFile(button) {
    try {
      const isVideo = button.dataset.resourceType === 'video';
      const { data, error } = await client.storage.from('classroom-files').createSignedUrl(button.dataset.file, 3600, { download: isVideo ? false : button.dataset.filename || false });
      if (error) throw error;
      if (button.dataset.resourceType === 'video') {
        const player = document.createElement('video');
        player.className = 'classroom-video';
        player.controls = true;
        player.playsInline = true;
        player.src = data.signedUrl;
        button.replaceWith(player);
        let recorded = false;
        player.addEventListener('timeupdate', async () => {
          if (recorded || !player.duration || player.currentTime / player.duration < 0.9 || profile.role !== 'student') return;
          recorded = true;
          try {
            await checked(client.from('video_watch_events').upsert({ resource_id: button.dataset.resourceId, student_id: user.id }, { onConflict: 'resource_id,student_id' }));
          } catch (watchError) {
            recorded = false;
            announce(`Video played, but watch progress could not be saved: ${watchError.message}`);
          }
        });
      } else {
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) { announce(error.message || 'This file is not available to your account.'); }
  }

  async function renderAssignments(subjects) {
    const { data: assignments, error } = await client.from('assignments').select('*, subjects(name,code)').order('due_at', { ascending: true });
    if (error) throw error;
    if (profile.role === 'teacher') {
      const ids = assignments.map(item => item.id);
      const { data: submissions } = ids.length ? await client.from('assignment_submissions').select('assignment_id,submitted_at,grade').in('assignment_id', ids) : { data: [] };
      const subjectIds = [...new Set(assignments.map(item => item.subject_id))];
      const { data: memberships } = subjectIds.length ? await client.from('subject_memberships').select('subject_id,student_id').in('subject_id', subjectIds) : { data: [] };
      const countFor = id => (submissions || []).filter(item => item.assignment_id === id).length;
      const studentCountFor = subjectId => (memberships || []).filter(item => item.subject_id === subjectId).length;
      shell('Assignments', 'Create and review work for your classroom subjects.', `<section class="panel form-panel"><div class="panel-heading"><div><span class="section-label">NEW ASSIGNMENT</span><h2>Create Assignment</h2></div></div><form id="assignment-form" class="form-grid"><label>Title<input name="title" required maxlength="150" placeholder="Algebra Practice Worksheet"></label><label>Subject<select name="subject_id" required>${subjectOptions(subjects)}</select></label><label class="full-field">Description<textarea name="description" rows="3" placeholder="Explain the work students need to do"></textarea></label><label>Due Date<input name="due_at" type="date"></label><label class="file-field">Upload PDF / Document (optional)<input name="file" type="file" accept=".pdf,.doc,.docx,image/jpeg,image/png"></label><button class="primary-button" type="submit">âœ“ Create Assignment</button></form></section>
        <section class="panel"><div class="panel-heading"><div><span class="section-label">YOUR CLASSROOM</span><h2>Existing Assignments</h2></div></div>${assignments.length ? `<div class="table-wrap"><table><thead><tr><th>TITLE</th><th>SUBJECT</th><th>DUE DATE</th><th>STUDENTS</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${assignments.map(item => `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.subjects?.name || 'â€”')}</td><td>${dateText(item.due_at)}</td><td>${studentCountFor(item.subject_id)}</td><td><span class="status-tag ${studentCountFor(item.subject_id) > 0 && countFor(item.id) >= studentCountFor(item.subject_id) ? 'complete' : ''}">${studentCountFor(item.subject_id) > 0 && countFor(item.id) >= studentCountFor(item.subject_id) ? 'Submitted' : 'Pending'}</span></td><td><button class="text-button" data-submissions="${item.id}">Review</button><button class="text-button" data-edit-assignment="${item.id}">Edit</button><button class="text-button danger-link" data-delete-assignment="${item.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : empty('No assignments have been created yet.')}</section>`);
      document.querySelector('#assignment-form').addEventListener('submit', createAssignment);
      return;
    }
    const ids = assignments.map(item => item.id);
    const { data: submissions } = ids.length ? await client.from('assignment_submissions').select('*').eq('student_id', user.id).in('assignment_id', ids) : { data: [] };
    const submitted = new Map((submissions || []).map(item => [item.assignment_id, item]));
    shell('Assignments', 'View upcoming class work and submit your answers.', assignments.length ? `<div class="assignment-list">${assignments.map(item => {
      const response = submitted.get(item.id);
      return `<article class="panel assignment-card"><div class="assignment-top"><div><span class="section-label">${escapeHtml(item.subjects?.name || 'SUBJECT')}</span><h2>${escapeHtml(item.title)}</h2></div><span class="status-tag ${response ? 'complete' : ''}">${response ? 'Submitted' : 'To do'}</span></div><p>${escapeHtml(item.description || 'Your teacher has shared a new assignment.')}</p><div class="assignment-meta"><span>Due ${dateText(item.due_at)}</span>${item.attachment_path ? `<button class="text-button" data-file="${escapeHtml(item.attachment_path)}" data-filename="assignment">View attached file</button>` : ''}</div>${response ? `<div class="submitted-box"><strong>Submitted ${dateText(response.submitted_at)}</strong>${response.grade !== null ? `<span>Grade ${response.grade}/100</span><p>${escapeHtml(response.feedback || '')}</p>` : '<span>Waiting for teacher review</span>'}</div>` : `<form class="submission-form" data-assignment="${item.id}"><label>Your response<textarea name="response_text" rows="3" placeholder="Write your answer here"></textarea></label><label class="file-field">Attach a document (optional)<input type="file" name="file" accept=".pdf,.doc,.docx,image/jpeg,image/png"></label><button class="primary-button" type="submit">Submit Assignment</button></form>`}</article>`;
    }).join('')}</div>` : empty('Your teachers have not shared assignments yet.'));
    document.querySelectorAll('.submission-form').forEach(form => form.addEventListener('submit', submitAssignment));
  }

  async function createAssignment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const id = crypto.randomUUID();
    const file = values.get('file');
    let path = null;
    try {
      if (file?.size) {
        path = `${values.get('subject_id')}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
        await checked(client.storage.from('classroom-files').upload(path, file, { contentType: file.type }));
      }
      const dueAt = values.get('due_at') ? new Date(`${values.get('due_at')}T23:59:00`).toISOString() : null;
      await checked(client.from('assignments').insert({ id, subject_id: values.get('subject_id'), created_by: user.id, title: values.get('title').trim(), description: values.get('description').trim(), due_at: dueAt, attachment_path: path }));
      form.reset();
      await renderAssignments(await subjectList());
      announce('Assignment created.', true);
    } catch (error) { if (path) await client.storage.from('classroom-files').remove([path]); announce(error.message || 'Could not create the assignment.'); }
  }

  async function submitAssignment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const assignmentId = form.dataset.assignment;
    const file = values.get('file');
    let path = null;
    try {
      if (file?.size) {
        path = `${assignmentId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
        await checked(client.storage.from('classroom-files').upload(path, file, { contentType: file.type }));
      }
      await checked(client.from('assignment_submissions').upsert({ assignment_id: assignmentId, student_id: user.id, response_text: values.get('response_text').trim(), storage_path: path, submitted_at: new Date().toISOString() }, { onConflict: 'assignment_id,student_id' }));
      await renderAssignments(await subjectList());
      announce('Your assignment has been submitted.', true);
    } catch (error) { if (path) await client.storage.from('classroom-files').remove([path]); announce(error.message || 'Could not submit the assignment.'); }
  }

  function questionEditor(index) {
    return `<fieldset class="question-editor"><legend>Question ${index + 1}</legend><label>Question<input name="prompt-${index}" required placeholder="Enter your question"></label><div class="option-grid">${[0,1,2,3].map((item) => `<label>Option ${String.fromCharCode(65 + item)}<input name="option-${index}-${item}" required placeholder="Answer choice"></label>`).join('')}</div><label>Correct answer<select name="correct-${index}">${[0,1,2,3].map(item => `<option value="${item}">Option ${String.fromCharCode(65 + item)}</option>`).join('')}</select></label><button type="button" class="text-button remove-question">Remove question</button></fieldset>`;
  }

  async function renderCreateTest(subjects) {
    shell('Create Mock Test', 'Add your own questions and options. Students will see the test instantly.', `<section class="panel form-panel"><form id="test-form" class="form-grid"><label>Test Title<input name="title" required placeholder="For example: Science - Chapter 2 Mock Test"></label><label>Subject<select name="subject_id" required>${subjectOptions(subjects)}</select></label><label class="full-field">Description<textarea name="description" rows="2" placeholder="Tell students what this test covers"></textarea></label><label>Duration (minutes)<input name="duration" type="number" min="1" max="300" value="20" required></label><div id="question-list" class="full-field"><span class="section-label">QUESTIONS</span>${questionEditor(0)}</div><button type="button" class="secondary-button" id="add-question">+ Add Question</button><button class="primary-button" type="submit">Create Mock Test</button></form></section><section id="existing-tests" class="panel"><div class="panel-heading"><div><span class="section-label">CLASSROOM</span><h2>Created Mock Tests</h2></div></div><div id="teacher-test-list"></div></section>`);
    let count = 1;
    document.querySelector('#add-question').addEventListener('click', () => {
      if (count >= 30) return announce('A test can contain up to 30 questions.');
      document.querySelector('#question-list').insertAdjacentHTML('beforeend', questionEditor(count++));
    });
    document.querySelector('#question-list').addEventListener('click', event => {
      if (event.target.matches('.remove-question')) {
        if (document.querySelectorAll('.question-editor').length <= 1) return announce('A test needs at least one question.');
        event.target.closest('.question-editor').remove();
      }
    });
    document.querySelector('#test-form').addEventListener('submit', event => createTest(event, subjects));
    const { data } = await client.from('mock_tests').select('*, subjects(name)').order('created_at', { ascending: false });
    document.querySelector('#teacher-test-list').innerHTML = data?.length ? `<div class="resource-list">${data.map(test => `<div class="resource-row"><span class="resource-icon">âœ“</span><div class="resource-detail"><h3>${escapeHtml(test.title)}</h3><p>${escapeHtml(test.subjects?.name || '')} Â· ${test.duration_minutes} min</p></div></div>`).join('')}</div>` : empty('No mock tests created yet.');
  }

  async function createTest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const id = crypto.randomUUID();
    const fields = [...document.querySelectorAll('.question-editor')];
    const questions = fields.map((_, index) => ({
      prompt: values.get(`prompt-${index}`),
      options: [0,1,2,3].map(item => values.get(`option-${index}-${item}`)),
      correct: Number(values.get(`correct-${index}`))
    }));
    if (questions.some(item => !item.prompt || item.options.some(option => !option))) return announce('Complete every question and answer option.');
    try {
      await checked(client.rpc('create_classroom_mock_test', {
        p_subject_id: values.get('subject_id'),
        p_title: values.get('title').trim(),
        p_description: values.get('description').trim(),
        p_duration_minutes: Number(values.get('duration')),
        p_questions: questions.map(question => ({ prompt: question.prompt.trim(), options: question.options.map(item => item.trim()), correct: question.correct }))
      }));
      await renderCreateTest(await subjectList());
      announce('Mock test created and shared with enrolled students.', true);
    } catch (error) { announce(error.message || 'Could not create the mock test.'); }
  }

  async function renderTests(subjects) {
    const { data: tests, error } = await client.from('mock_tests').select('*, subjects(name)').order('created_at', { ascending: false });
    if (error) throw error;
    const { data: attempts, error: attemptsError } = await client.from('mock_test_attempts').select('test_id,score,total_questions').eq('student_id', user.id);
    const done = new Map((attemptsError ? [] : attempts).map(attempt => [attempt.test_id, attempt]));
    shell('Mock Tests', 'Take a test shared by your teacher and see your result as soon as you submit.', tests.length ? `<div class="assignment-list">${tests.map(test => {
      const result = done.get(test.id);
      return `<article class="panel assignment-card"><div class="assignment-top"><div><span class="section-label">${escapeHtml(test.subjects?.name || 'SUBJECT')}</span><h2>${escapeHtml(test.title)}</h2></div><span class="status-tag ${result ? 'complete' : ''}">${result ? `${result.score}/${result.total} correct` : `${test.duration_minutes} min`}</span></div><p>${escapeHtml(test.description || 'Multiple-choice classroom test.')}</p>${result ? '<span class="completed-line">âœ“ Completed</span>' : `<button class="primary-button" data-start-test="${test.id}">Start Test</button>`}</article>`;
    }).join('')}</div>` : empty('Your teacher has not shared any mock tests yet.'));
    document.querySelectorAll('[data-start-test]').forEach(button => button.addEventListener('click', () => startTest(button.dataset.startTest, subjects)));
  }

  async function startTest(testId) {
    try {
      const test = await checked(client.from('mock_tests').select('*, subjects(name)').eq('id', testId).single());
      const questions = await checked(client.from('mock_test_questions').select('id,position,prompt,options').eq('test_id', testId).order('position'));
      const dateLabel = escapeHtml(test.subjects?.name || 'SUBJECT');
      shell(test.title, `${dateLabel} Â· ${test.duration_minutes} minutes`, `<form id="take-test-form" data-test="${test.id}"><div class="test-question-list">${questions.map((question, index) => `<fieldset class="test-question"><legend>${index + 1}. ${escapeHtml(question.prompt)}</legend>${question.options.map((option, answer) => `<label class="answer-option"><input type="radio" name="q-${question.id}" value="${answer}" required><span>${String.fromCharCode(65 + answer)}.</span> ${escapeHtml(option)}</label>`).join('')}</fieldset>`).join('')}</div><button class="primary-button" type="submit">Submit Test</button> <button class="secondary-button" type="button" data-go="tests">Cancel</button></form>`);
      document.querySelector('#take-test-form').addEventListener('submit', submitTest);
    } catch (error) { announce(error.message || 'Could not open this test.'); }
  }

  async function submitTest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const answers = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (key.startsWith('q-')) answers[key.slice(2)] = Number(value);
    }
    try {
      const result = await checked(client.rpc('submit_mock_test', { p_test_id: form.dataset.test, p_answers: answers }));
      await renderTests(await subjectList());
      announce(`Test submitted. Score: ${result.score} out of ${result.total}.`, true);
    } catch (error) { announce(error.message || 'Could not submit your test.'); }
  }

  async function renderStudents(subjects) {
    const membershipResults = await Promise.all(subjects.map(subject => client.from('subject_memberships').select('student_id,subjects(name,code)').eq('subject_id', subject.id)));
    const idSet = [...new Set(membershipResults.flatMap(result => (result.data || []).map(row => row.student_id)))];
    const students = idSet.length ? await checked(client.from('profiles').select('id,full_name,email,class_name,account_status').in('id', idSet).order('full_name')) : [];
    const watchEvents = idSet.length ? await checked(client.from('video_watch_events').select('student_id,resource_id,watched_at').in('student_id', idSet).order('watched_at', { ascending: false })) : [];
    const watchedIds = [...new Set(watchEvents.map(event => event.resource_id))];
    const watchedVideos = watchedIds.length ? await checked(client.from('learning_resources').select('id,title').in('id', watchedIds)) : [];
    const watchedTitles = new Map(watchedVideos.map(video => [video.id, video.title]));
    const watchedByStudent = new Map();
    for (const event of watchEvents) {
      const title = watchedTitles.get(event.resource_id);
      if (!title) continue;
      if (!watchedByStudent.has(event.student_id)) watchedByStudent.set(event.student_id, []);
      watchedByStudent.get(event.student_id).push(title);
    }
    const classByStudent = new Map();
    for (const result of membershipResults) for (const membership of result.data || []) classByStudent.set(membership.student_id, membership.subjects?.name || 'â€”');
    shell('Students', 'Students enrolled in your classroom subjects, including completed video lessons.', students.length ? `<section class="panel"><div class="panel-heading"><div><span class="section-label">CLASS ROSTER</span><h2>My Students</h2></div><input id="student-search" class="table-search" type="search" placeholder="Search by name or email"></div><div class="table-wrap"><table id="students-table"><thead><tr><th>STUDENT</th><th>CLASS</th><th>EMAIL</th><th>VIDEOS WATCHED</th><th>STATUS</th></tr></thead><tbody>${students.map(student => { const titles = watchedByStudent.get(student.id) || []; return `<tr><td><strong>${escapeHtml(student.full_name)}</strong></td><td>${escapeHtml(student.class_name || classByStudent.get(student.id) || 'â€”')}</td><td>${escapeHtml(student.email)}</td><td>${titles.length ? titles.map(escapeHtml).join('<br>') : '<span class="muted-text">No completed videos</span>'}</td><td><span class="status-tag ${student.account_status === 'active' ? 'complete' : ''}">${escapeHtml(student.account_status || 'active')}</span></td></tr>`; }).join('')}</tbody></table></div></section>` : empty('No students are enrolled in your subjects yet. Add an existing student from the Subjects page.'));
    document.querySelector('#student-search')?.addEventListener('input', event => {
      const term = event.currentTarget.value.toLowerCase();
      document.querySelectorAll('#students-table tbody tr').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(term); });
    });
  }

  async function renderPeople() {
    const people = await checked(client.from('profiles').select('id,full_name,email,role,class_name,account_status,created_at').in('role', ['student','teacher']).order('role').order('full_name'));
    shell('Students & Teachers', 'Invite classroom members and manage the current account list.', `<section class="panel form-panel"><div class="panel-heading"><div><span class="section-label">CLASSROOM ACCESS</span><h2>Invite a member</h2></div></div><form id="invite-form" class="form-grid"><label>Full name<input name="name" required placeholder="Full name"></label><label>Email address<input name="email" type="email" required placeholder="name@example.com"></label><label>Role<select name="role"><option value="student">Student</option><option value="teacher">Teacher</option></select></label><label>Class / grade (students)<input name="class_name" placeholder="10th"></label><button class="primary-button" type="submit">Send invitation</button></form></section><section class="panel"><div class="panel-heading"><div><span class="section-label">REGISTERED MEMBERS</span><h2>Students and teachers</h2></div></div>${people.length ? `<div class="table-wrap"><table><thead><tr><th>NAME</th><th>ROLE</th><th>CLASS</th><th>EMAIL</th><th>STATUS</th></tr></thead><tbody>${people.map(item => `<tr><td><strong>${escapeHtml(item.full_name)}</strong></td><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.class_name || 'â€”')}</td><td>${escapeHtml(item.email)}</td><td><span class="status-tag ${item.account_status === 'active' ? 'complete' : ''}">${escapeHtml(item.account_status || 'active')}</span></td></tr>`).join('')}</tbody></table></div>` : empty('No invited members yet.')}</section>`);
    document.querySelector('#invite-form').addEventListener('submit', inviteMember);
  }

  async function inviteMember(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const response = await client.functions.invoke('invite-member', { body: { name: values.get('name').trim(), email: values.get('email').trim().toLowerCase(), role: values.get('role'), class_name: values.get('class_name').trim() } });
      if (response.error) throw response.error;
      if (response.data?.error) throw new Error(response.data.error);
      form.reset();
      await renderPeople();
      announce(response.data?.message || 'Member access has been added.', true);
    } catch (error) { announce(error.message || 'Could not send the invitation. Check the invite-member function deployment and secrets.'); }
  }

  async function renderProfile(subjects) {
    const taughtSubjects = profile.role === 'teacher' ? subjects.map(subject => subject.name).join(', ') : '';
    shell('Profile', profile.role === 'teacher' ? 'Edit your teacher account details.' : 'Account information used in your classroom.', `<section class="panel form-panel profile-panel"><div class="profile-emblem">${escapeHtml(profile.full_name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase())}</div><form id="profile-form" class="form-grid"><label>Full name<input name="full_name" value="${escapeHtml(profile.full_name)}" required maxlength="120"></label><label>Email address<input value="${escapeHtml(profile.email)}" disabled></label>${profile.role === 'student' ? `<label>Class / grade<input name="class_name" value="${escapeHtml(profile.class_name || '')}" placeholder="10th"></label>` : ''}${profile.role === 'teacher' ? `<label>School<input name="school_name" value="${escapeHtml(profile.school_name || '')}" placeholder="School name"></label><label class="full-field">Subjects you teach<input value="${escapeHtml(taughtSubjects)}" disabled><small>Manage your subjects from the Subjects page.</small></label>` : ''}<label>Role<input value="${escapeHtml(profile.role[0].toUpperCase() + profile.role.slice(1))}" disabled></label><button class="primary-button" type="submit">Save Profile</button></form></section>`);
    document.querySelector('#profile-form').addEventListener('submit', saveProfile);
  }

  async function saveProfile(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      await checked(client.rpc('update_my_profile', { p_full_name: values.get('full_name').trim(), p_class_name: values.get('class_name')?.trim() || null, p_school_name: values.get('school_name')?.trim() || null }));
      profile = await checked(client.from('profiles').select('*').eq('id', user.id).single());
      document.querySelector('#user-name').textContent = profile.full_name;
      document.querySelector('#user-initials').textContent = profile.full_name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
      await go('profile');
      announce('Profile saved.', true);
    } catch (error) { announce(error.message || 'Could not save your profile.'); }
  }

  document.querySelectorAll('[data-login]').forEach(button => button.addEventListener('click', () => openLogin(button.dataset.login)));
  document.querySelectorAll('[data-home]').forEach(button => button.addEventListener('click', () => showView('home')));
  document.querySelectorAll('.login-role[data-role]').forEach(button => button.addEventListener('click', () => setLoginRole(button.dataset.role)));

  document.querySelector('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.querySelector('#login-message');
    message.textContent = '';
    if (!client) { message.textContent = 'Add the Supabase URL and anon key to config.js to connect sign in.'; return; }
    const form = new FormData(event.currentTarget);
    const { data, error } = await client.auth.signInWithPassword({ email: form.get('email').trim().toLowerCase(), password: form.get('password') });
    if (error) { message.textContent = error.message || 'Login failed. Check your email and password, then try again.'; return; }
    try {
      const memberProfile = await loadProfile(data.user);
      if (memberProfile.role !== roleChoice) throw new Error('This account does not have access to that classroom. Choose the role assigned by your administrator.');
      await enterClassroom(data.user, memberProfile);
    } catch (profileError) {
      message.textContent = profileError.message || 'This account has not been added to the classroom.';
    }
  });

  nav.addEventListener('click', event => {
    const button = event.target.closest('[data-nav]');
    if (button) go(button.dataset.nav);
  });
  content.addEventListener('click', event => {
    const navButton = event.target.closest('[data-go]');
    if (navButton) { go(navButton.dataset.go); return; }
    const fileButton = event.target.closest('[data-file]');
    if (fileButton) { openFile(fileButton); return; }
    const enroll = event.target.closest('[data-enroll]');
    if (enroll) enrollStudent(enroll.dataset.enroll);
    const review = event.target.closest('[data-submissions]');
    if (review) reviewSubmissions(review.dataset.submissions);
    const editAssignment = event.target.closest('[data-edit-assignment]');
    if (editAssignment) editAssignmentDetails(editAssignment.dataset.editAssignment);
    const deleteAssignment = event.target.closest('[data-delete-assignment]');
    if (deleteAssignment) deleteAssignmentRow(deleteAssignment.dataset.deleteAssignment);
  });
  document.querySelector('#logout-button').addEventListener('click', async () => {
    if (client) await client.auth.signOut({ scope: 'local' });
    user = profile = null;
    showView('home');
  });

  async function enrollStudent(subjectId) {
    const email = window.prompt('Enter the email address of an existing student account:');
    if (!email) return;
    try {
      await checked(client.rpc('enroll_student_by_email', { p_subject_id: subjectId, p_email: email.trim().toLowerCase() }));
      await go('students');
      announce('Student added to the subject.', true);
    } catch (error) { announce(error.message || 'Could not add the student. Check their email and classroom account.'); }
  }

  async function reviewSubmissions(assignmentId) {
    try {
      const rows = await checked(client.from('assignment_submissions').select('*, profiles(full_name,email)').eq('assignment_id', assignmentId).order('submitted_at', { ascending: false }));
      const assignment = await checked(client.from('assignments').select('title').eq('id', assignmentId).single());
      shell(`Review: ${assignment.title}`, 'Review student work and record a grade from 0 to 100.', rows.length ? `<section class="panel"><div class="submission-review-list">${rows.map(row => `<article class="submission-review"><div><h3>${escapeHtml(row.profiles?.full_name || 'Student')}</h3><small>${escapeHtml(row.profiles?.email || '')} Â· Submitted ${dateText(row.submitted_at)}</small><p>${escapeHtml(row.response_text || 'File submission')}</p>${row.storage_path ? `<button class="text-button" data-file="${escapeHtml(row.storage_path)}" data-filename="submission">Open attachment</button>` : ''}</div><form class="grade-form" data-submission="${row.id}"><label>Grade / 100<input name="grade" type="number" min="0" max="100" value="${row.grade ?? ''}" required></label><label>Feedback<textarea name="feedback" rows="2">${escapeHtml(row.feedback || '')}</textarea></label><button class="primary-button" type="submit">Save Grade</button></form></article>`).join('')}</div></section>` : empty('No students have submitted work yet.'));
      document.querySelectorAll('.grade-form').forEach(form => form.addEventListener('submit', saveGrade));
    } catch (error) { announce(error.message || 'Could not load submissions.'); }
  }

  async function editAssignmentDetails(assignmentId) {
    try {
      const assignment = await checked(client.from('assignments').select('id,title,description,due_at').eq('id', assignmentId).single());
      const title = window.prompt('Assignment title', assignment.title);
      if (title === null) return;
      const description = window.prompt('Assignment description', assignment.description || '');
      if (description === null) return;
      const { error } = await client.from('assignments').update({ title: title.trim(), description: description.trim() }).eq('id', assignmentId);
      if (error) throw error;
      await renderAssignments(await subjectList());
      announce('Assignment updated.', true);
    } catch (error) { announce(error.message || 'Could not update the assignment.'); }
  }

  async function deleteAssignmentRow(assignmentId) {
    if (!window.confirm('Delete this assignment and its student submissions?')) return;
    try {
      const assignment = await checked(client.from('assignments').select('attachment_path').eq('id', assignmentId).single());
      const rows = await checked(client.from('assignment_submissions').select('storage_path').eq('assignment_id', assignmentId));
      const files = [...rows.map(row => row.storage_path).filter(Boolean), assignment.attachment_path].filter(Boolean);
      if (files.length) await checked(client.storage.from('classroom-files').remove(files));
      await checked(client.from('assignments').delete().eq('id', assignmentId));
      await renderAssignments(await subjectList());
      announce('Assignment and submissions deleted.', true);
    } catch (error) { announce(error.message || 'Could not delete the assignment.'); }
  }

  async function saveGrade(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await checked(client.from('assignment_submissions').update({ grade: Number(values.get('grade')), feedback: values.get('feedback').trim() }).eq('id', form.dataset.submission));
      announce('Grade saved.', true);
    } catch (error) { announce(error.message || 'Could not save the grade.'); }
  }

  if (client) {
    client.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      try { await enterClassroom(data.session.user, await loadProfile(data.session.user)); }
      catch (error) {
        setLoginRole(data.session.user.email?.toLowerCase() === (config.adminEmail || '').toLowerCase() ? 'admin' : 'student');
        document.querySelector('#login-email').value = data.session.user.email || '';
        showView('login');
        document.querySelector('#login-message').textContent = `${error.message || 'This account is not allowed into the classroom yet.'} Your session is kept; fix the profile access and refresh.`;
      }
    });
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' && !session) {
        user = profile = null;
        if (!views.app.hidden) showView('login');
      }
    });
  }
})();
