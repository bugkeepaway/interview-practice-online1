const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {}
    return { users: [], rooms: [], questions: [], settings: {} };
}

function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('Data saved successfully');
    } catch (e) {
        console.error('Error saving data:', e.message);
    }
}

let data = loadData();

const DEFAULT_QUESTIONS = [
    { id: 1, title: "请自我介绍并谈谈你的优势", desc: "请用2-3分钟时间进行自我介绍，并阐述你为什么适合这个岗位。", image: "https://picsum.photos/600/400?random=1", category: "自我介绍" },
    { id: 2, title: "请描述你最大的缺点", desc: "谈谈你的不足之处，以及你正在如何改进。", image: "https://picsum.photos/600/400?random=2", category: "自我认知" },
    { id: 3, title: "你为什么想加入我们公司", desc: "请说明你选择我们公司的原因以及你的职业规划。", image: "https://picsum.photos/600/400?random=3", category: "求职动机" },
    { id: 4, title: "请举例说明你解决困难的经验", desc: "描述一次你面对挑战并成功解决问题的经历。", image: "https://picsum.photos/600/400?random=4", category: "经验问题" },
    { id: 5, title: "你的期望薪资是多少", desc: "谈谈你的薪酬期望以及理由。", image: "https://picsum.photos/600/400?random=5", category: "薪资问题" },
    { id: 6, title: "请谈谈你的职业规划", desc: "未来3-5年你有什么职业目标？", image: "https://picsum.photos/600/400?random=6", category: "职业规划" },
    { id: 7, title: "你为什么离职", desc: "请说明上一份工作的离职原因。", image: "https://picsum.photos/600/400?random=7", category: "离职原因" },
    { id: 8, title: "你最大的成就是什么", desc: "请分享一个你最有成就感的事情。", image: "https://picsum.photos/600/400?random=8", category: "成就事件" }
];

let openaiApiKey = data.settings?.openaiApiKey || '';
let useDeepSeek = data.settings?.useDeepSeek || false;

function setOpenAIApiKey(key, useDeep = false) {
    openaiApiKey = key;
    useDeepSeek = useDeep;
    if (!data.settings) data.settings = {};
    data.settings.openaiApiKey = key;
    data.settings.useDeepSeek = useDeep;
    saveData(data);
}

async function generateAIAnswer(question, transcribedText) {
    if (!openaiApiKey) {
        return getDefaultAnswer(question, transcribedText);
    }
    
    const baseUrl = useDeepSeek ? 'https://api.deepseek.com' : 'https://api.openai.com';
    const model = useDeepSeek ? 'deepseek-chat' : 'gpt-3.5-turbo';
    
    try {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: '你是一位专业的面试官AI助手。请根据考生的回答给出评价和优化建议。'
                    },
                    {
                        role: 'user',
                        content: `面试题目：${question.title}\n题目描述：${question.desc}\n\n考生的回答：${transcribedText || '（考生还未开始答题）'}\n\n请给出：1. 对考生回答的评价（60字以内）2. 一个优化的参考答案（150字以内）\n\n请用JSON格式返回，格式如下：{"feedback":"评价内容","answer":"优化答案内容"}`
                    }
                ],
                max_tokens: 500,
                temperature: 0.7
            })
        });
        
        const data = await response.json();
        if (data.choices && data.choices[0]) {
            try {
                const result = JSON.parse(data.choices[0].message.content);
                return {
                    feedback: result.feedback || getDefaultFeedback(),
                    answer: result.answer || getDefaultAnswer(question)
                };
            } catch (e) {
                return getDefaultAnswer(question, transcribedText);
            }
        }
    } catch (e) {
        console.error('AI API error:', e.message);
    }
    return getDefaultAnswer(question, transcribedText);
}

function getDefaultAnswer(question, transcribedText = '') {
    const feedbacks = [
        '表达清晰有条理，但可以更加自信一些。建议多使用具体案例来支撑你的观点。',
        '整体表现不错，语言流畅。建议在回答问题时更加具体一些，多展示你的实际能力。',
        '回答得很全面，但语速稍快。建议适当停顿，给面试官思考的时间。',
        '思路清晰，回答有针对性。可以增加一些个人特色的表达，让回答更有记忆点。',
        '内容充实，但缺乏与岗位的关联性。建议多强调与职位相关的能力和经验。',
        '逻辑清晰，但情感表达稍显不足。建议增加一些真诚的情感表达。'
    ];
    const answers = [
        `感谢面试官，我叫XXX，毕业于XX大学XX专业。在校期间，我积累了扎实的专业基础，曾获得XX奖项。毕业后我一直在从事相关工作，积累了丰富的项目经验。我认为自己最大的优势是学习能力强、善于沟通、具备团队协作精神。相信我的能力可以为贵公司创造价值。`,
        `您好，我叫XXX。我是一名有着3年工作经验的XX专业人才。在上一家公司，我负责XX工作，成功完成了XX项目，取得了XX成果。我对贵公司的XX岗位非常感兴趣，希望能够加入团队共同发展。`,
        `面试官好，我是XXX。我竞选这个岗位的优势主要有三点：第一，我具备扎实的专业技能；第二，我有丰富的项目经验；第三，我有良好的团队协作能力。我相信这些优势能够帮助我胜任这份工作。`
    ];
    return {
        feedback: transcribedText ? feedbacks[Math.floor(Math.random() * feedbacks.length)] : '请开始答题',
        answer: answers[Math.floor(Math.random() * answers.length)]
    };
}

function getDefaultFeedback() {
    const feedbacks = [
        '表达清晰有条理，但可以更加自信一些。建议多使用具体案例来支撑你的观点。',
        '整体表现不错，语言流畅。建议在回答问题时更加具体一些，多展示你的实际能力。',
        '回答得很全面，但语速稍快。建议适当停顿，给面试官思考的时间。',
        '思路清晰，回答有针对性。可以增加一些个人特色的表达，让回答更有记忆点。',
        '内容充实，但缺乏与岗位的关联性。建议多强调与职位相关的能力和经验。',
        '逻辑清晰，但情感表达稍显不足。建议增加一些真诚的情感表达。'
    ];
    return feedbacks[Math.floor(Math.random() * feedbacks.length)];
}

if (data.questions.length === 0) {
    data.questions = [...DEFAULT_QUESTIONS];
    saveData(data);
}

const rooms = new Map();
const users = new Map();

data.rooms.forEach(r => {
    rooms.set(r.id, { ...r, timer: null });
});

function createRoom() {
    const roomId = uuidv4().slice(0, 8).toUpperCase();
    const room = {
        id: roomId,
        adminId: null,
        adminName: null,
        candidates: [],
        currentIndex: 0,
        questionIndex: 0,
        questions: [...(data.questions.length ? data.questions : DEFAULT_QUESTIONS)],
        timerDuration: 300,
        transitionTime: 30,
        status: 'waiting',
        currentQuestion: null,
        timer: null,
        timeLeft: 300,
        createdAt: Date.now(),
        history: []
    };
    rooms.set(roomId, room);
    return room;
}

app.post('/api/register', (req, res) => {
    const { username, password, nickname } = req.body;
    if (!username || !password) {
        return res.json({ success: false, error: '请填写用户名和密码' });
    }
    if (data.users.find(u => u.username === username)) {
        return res.json({ success: false, error: '用户名已存在' });
    }
    const user = {
        id: uuidv4(),
        username,
        password,
        nickname: nickname || username,
        role: 'user',
        createdAt: Date.now(),
        stats: { total: 0, passed: 0, avgScore: 0 }
    };
    data.users.push(user);
    saveData(data);
    res.json({ success: true, user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role } });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = data.users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.json({ success: false, error: '用户名或密码错误' });
    }
    res.json({ success: true, user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role, stats: user.stats } });
});

app.get('/api/questions', (req, res) => {
    res.json({ success: true, questions: data.questions });
});

app.post('/api/questions', (req, res) => {
    const { title, desc, category } = req.body;
    if (!title) {
        return res.json({ success: false, error: '请填写题目标题' });
    }
    const question = {
        id: Date.now(),
        title,
        desc: desc || '',
        category: category || '其他',
        image: `https://picsum.photos/600/400?random=${Date.now()}`
    };
    data.questions.push(question);
    saveData(data);
    res.json({ success: true, question });
});

app.delete('/api/questions/:id', (req, res) => {
    const id = parseInt(req.params.id);
    data.questions = data.questions.filter(q => q.id !== id);
    rooms.forEach(room => {
        room.questions = room.questions.filter(q => q.id !== id);
    });
    saveData(data);
    res.json({ success: true });
});

app.post('/api/settings', (req, res) => {
    const { openaiApiKey, timerDuration, useDeepSeek } = req.body;
    if (!data.settings) data.settings = {};
    if (openaiApiKey) {
        data.settings.openaiApiKey = openaiApiKey;
        setOpenAIApiKey(openaiApiKey, useDeepSeek === true);
    }
    if (timerDuration) {
        data.settings.timerDuration = timerDuration;
    }
    saveData(data);
    res.json({ success: true });
});

app.get('/api/settings', (req, res) => {
    res.json({ 
        success: true, 
        settings: {
            openaiApiKey: openaiApiKey ? '***' : '',
            timerDuration: data.settings?.timerDuration || 5,
            useDeepSeek: useDeepSeek
        }
    });
});

app.get('/api/users', (req, res) => {
    const token = req.headers.authorization;
    const user = users.get(token);
    if (!user || user.role !== 'admin') {
        return res.json({ success: false, error: '无权限' });
    }
    res.json({ success: true, users: data.users.map(u => ({ id: u.id, username: u.username, nickname: u.nickname, stats: u.stats, createdAt: u.createdAt })) });
});

app.get('/api/history', (req, res) => {
    const token = req.headers.authorization || req.query.token;
    let userId = req.query.userId;
    
    if (!userId && token) {
        const user = Array.from(users.values()).find(u => u.id === token);
        if (user) userId = user.id;
    }
    
    if (!userId) {
        return res.json({ success: false, error: '未授权' });
    }
    
    const user = data.users.find(u => u.id === userId);
    if (!user) {
        return res.json({ success: false, error: '用户不存在' });
    }
    
    res.json({ success: true, history: user.answerHistory || [] });
});

io.on('connection', (socket) => {
    console.log(`用户连接: ${socket.id}`);

    socket.on('auth', (token) => {
        if (token) {
            const userData = data.users.find(u => u.id === token);
            if (userData) {
                users.set(socket.id, { ...userData, roomId: null, currentRoomId: null });
            }
        }
    });

    socket.on('createRoom', (data, callback) => {
        const user = users.get(socket.id);
        if (!user) {
            return callback({ success: false, error: '请先登录' });
        }
        const room = createRoom();
        room.adminId = socket.id;
        room.adminName = user.nickname;
        user.roomId = room.id;
        user.role = 'admin';
        socket.join(room.id);
        callback({ success: true, room: serializeRoom(room), user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role } });
        console.log(`房间创建: ${room.id} by ${user.nickname}`);
    });

    socket.on('joinRoom', (data, callback) => {
        const user = users.get(socket.id);
        if (!user) {
            return callback({ success: false, error: '请先登录' });
        }
        const room = rooms.get(data.roomId);
        if (!room) {
            return callback({ success: false, error: '房间不存在' });
        }
        if (room.status === 'started') {
            return callback({ success: false, error: '考试已开始，无法加入' });
        }
        if (room.candidates.length >= 20) {
            return callback({ success: false, error: '房间已满' });
        }

        const candidate = {
            id: socket.id,
            odUserId: user.id,
            name: user.nickname,
            username: user.username,
            status: 'waiting',
            score: null,
            feedback: '',
            answer: '',
            muted: false,
            isSpeaking: false,
            joinTime: Date.now()
        };
        room.candidates.push(candidate);
        user.roomId = room.id;
        socket.join(room.id);

        io.to(room.id).emit('roomUpdate', serializeRoom(room));
        callback({ success: true, room: serializeRoom(room) });
        console.log(`${user.nickname} 加入房间 ${room.id}`);
    });

    socket.on('startExam', (callback) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            return callback({ success: false, error: '只有管理员可以开始考试' });
        }
        const room = rooms.get(user.roomId);
        if (room.candidates.length < 1) {
            return callback({ success: false, error: '没有考生' });
        }

        room.status = 'started';
        room.currentIndex = 0;
        room.questionIndex = 0;
        room.currentQuestion = room.questions[0];
        room.timeLeft = room.timerDuration;
        room.candidates.forEach((c, i) => {
            c.status = i === 0 ? 'answering' : 'waiting';
            c.score = null;
            c.feedback = '';
            c.answer = '';
        });

        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
        io.to(user.roomId).emit('examStart', { question: room.currentQuestion });
        startTimer(room);
        callback({ success: true });
    });

    socket.on('startAnswer', (callback) => {
        const user = users.get(socket.id);
        if (!user) {
            return callback({ success: false, error: '未登录' });
        }
        const room = rooms.get(user.roomId);
        const candidate = room.candidates.find(c => c.id === socket.id);

        if (!candidate) {
            return callback({ success: false, error: '未找到考生' });
        }
        if (candidate.muted) {
            return callback({ success: false, error: '已被禁言' });
        }
        if (candidate.status !== 'waiting' && candidate.status !== 'answering') {
            return callback({ success: false, error: '当前不是你的答题时间' });
        }

        room.candidates.forEach((c, i) => {
            if (i === room.currentIndex) {
                c.status = 'answering';
                c.isSpeaking = true;
            } else {
                c.status = 'rest';
                c.isSpeaking = false;
            }
        });

        room.timeLeft = room.timerDuration;
        room.currentQuestion = room.questions[room.questionIndex];
        startTimer(room);

        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
        io.to(user.roomId).emit('answerStart', { candidate: candidate.name, question: room.currentQuestion });
        callback({ success: true, question: room.currentQuestion });
    });

    socket.on('stopAnswer', async (data, callback) => {
        const user = users.get(socket.id);
        if (!user || !user.roomId) {
            if (callback) callback({ success: false, error: '未找到用户' });
            return;
        }
        const room = rooms.get(user.roomId);
        if (!room) {
            if (callback) callback({ success: false, error: '房间不存在' });
            return;
        }
        
        const transcribedText = data?.transcribedText || '';

        if (room.timer) {
            clearInterval(room.timer);
            room.timer = null;
        }

        const currentCandidate = room.candidates[room.currentIndex];
        if (currentCandidate) {
            currentCandidate.status = 'completed';
            currentCandidate.isSpeaking = false;

            const score = Math.floor(Math.random() * 30) + 70;
            
            let aiResult;
            try {
                if (transcribedText && transcribedText.length > 5) {
                    aiResult = await generateAIAnswer(room.currentQuestion, transcribedText);
                } else {
                    aiResult = getDefaultAnswer(room.currentQuestion, transcribedText);
                }
            } catch (e) {
                console.error('AI generation error:', e);
                aiResult = getDefaultAnswer(room.currentQuestion, transcribedText);
            }

            currentCandidate.score = score;
            currentCandidate.feedback = aiResult.feedback;
            currentCandidate.answer = aiResult.answer;
            currentCandidate.transcribedText = transcribedText;
            currentCandidate.finishTime = Date.now();

            const odUser = data.users.find(u => u.id === currentCandidate.odUserId);
            if (odUser) {
                odUser.stats = odUser.stats || { total: 0, passed: 0, avgScore: 0 };
                odUser.stats.total++;
                odUser.stats.avgScore = Math.round((odUser.stats.avgScore * (odUser.stats.total - 1) + score) / odUser.stats.total);
                if (score >= 80) odUser.stats.passed++;
                
                if (!odUser.answerHistory) odUser.answerHistory = [];
                odUser.answerHistory.unshift({
                    question: room.currentQuestion.title,
                    questionDesc: room.currentQuestion.desc,
                    category: room.currentQuestion.category,
                    transcribedText: transcribedText,
                    score: score,
                    feedback: aiResult.feedback,
                    answer: aiResult.answer,
                    time: Date.now()
                });
                if (odUser.answerHistory.length > 100) {
                    odUser.answerHistory = odUser.answerHistory.slice(0, 100);
                }
                
                saveData(data);
            } else {
                console.log('User not found for answer:', currentCandidate.odUserId);
            }

            room.history.push({
                candidateId: currentCandidate.id,
                name: currentCandidate.name,
                score: score,
                feedback: currentCandidate.feedback,
                time: Date.now()
            });
        }

        io.to(user.roomId).emit('answerEnd', { candidate: currentCandidate, score: currentCandidate.score });
        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));

        if (callback) callback({ success: true, candidate: currentCandidate });
    });

    socket.on('nextCandidate', (callback) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            return callback({ success: false, error: '只有管理员可以切换' });
        }
        const room = rooms.get(user.roomId);

        room.currentIndex++;
        room.questionIndex++;

        if (room.currentIndex >= room.candidates.length) {
            room.status = 'finished';
            io.to(user.roomId).emit('examEnd', { candidates: room.candidates, history: room.history });
            if (callback) callback({ success: true, finished: true });
            return;
        }

        if (room.questionIndex >= room.questions.length) {
            room.questionIndex = 0;
        }

        room.candidates.forEach((c, i) => {
            if (i === room.currentIndex) {
                c.status = 'waiting';
                c.isSpeaking = false;
            } else if (i < room.currentIndex) {
                c.status = 'completed';
            } else {
                c.status = 'waiting';
            }
        });

        room.currentQuestion = room.questions[room.questionIndex];
        room.timeLeft = room.timerDuration;
        
        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
        io.to(user.roomId).emit('candidateChange', { nextCandidate: room.candidates[room.currentIndex].name, question: room.currentQuestion });
        
        startTimer(room);

        if (callback) callback({ success: true, finished: false });
    });

    socket.on('toggleMute', (data, callback) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            return callback({ success: false, error: '只有管理员可以禁言' });
        }
        const room = rooms.get(user.roomId);
        const candidate = room.candidates.find(c => c.id === data.candidateId);
        if (candidate) {
            candidate.muted = !candidate.muted;
            io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
            callback({ success: true, muted: candidate.muted });
        }
    });

    socket.on('removeCandidate', (data, callback) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            return callback({ success: false, error: '只有管理员可以移除考生' });
        }
        const room = rooms.get(user.roomId);
        const index = room.candidates.findIndex(c => c.id === data.candidateId);
        if (index > -1) {
            room.candidates.splice(index, 1);
            if (room.currentIndex >= room.candidates.length) {
                room.currentIndex = Math.max(0, room.candidates.length - 1);
            }
            io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
            callback({ success: true });
        }
    });

    socket.on('addQuestion', (data, callback) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            return callback({ success: false, error: '只有管理员可以添加题目' });
        }
        const room = rooms.get(user.roomId);
        const question = {
            id: Date.now(),
            title: data.title,
            desc: data.desc || '',
            category: data.category || '其他',
            image: `https://picsum.photos/600/400?random=${Date.now()}`
        };
        room.questions.push(question);
        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
        callback({ success: true });
    });

    socket.on('deleteQuestion', (data, callback) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            return callback({ success: false, error: '只有管理员可以删除题目' });
        }
        const room = rooms.get(user.roomId);
        room.questions = room.questions.filter(q => q.id !== data.questionId);
        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
        callback({ success: true });
    });

    socket.on('getRoomInfo', (callback) => {
        const user = users.get(socket.id);
        if (!user) {
            return callback({ success: false, error: '未登录' });
        }
        const room = rooms.get(user.roomId);
        if (!room) {
            return callback({ success: false, error: '未加入房间' });
        }
        callback({ success: true, room: serializeRoom(room), user: user });
    });

    socket.on('getMyStats', (callback) => {
        const user = users.get(socket.id);
        if (!user) {
            return callback({ success: false, error: '未登录' });
        }
        const odUser = data.users.find(u => u.id === user.id);
        if (odUser) {
            callback({ success: true, stats: odUser.stats || { total: 0, passed: 0, avgScore: 0 } });
        } else {
            callback({ success: true, stats: { total: 0, passed: 0, avgScore: 0 } });
        }
    });

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            const room = rooms.get(user.roomId);
            if (room) {
                if (user.role === 'admin') {
                    io.to(room.id).emit('adminLeft');
                    room.history = [];
                    rooms.delete(room.id);
                } else {
                    const index = room.candidates.findIndex(c => c.id === socket.id);
                    if (index > -1) {
                        const candidate = room.candidates[index];
                        if (room.status === 'waiting') {
                            room.candidates.splice(index, 1);
                            if (room.currentIndex >= room.candidates.length) {
                                room.currentIndex = Math.max(0, room.candidates.length - 1);
                            }
                            io.to(room.id).emit('roomUpdate', serializeRoom(room));
                        }
                    }
                }
            }
            users.delete(socket.id);
        }
        console.log(`用户断开: ${socket.id}`);
    });
});

function startTimer(room) {
    if (room.timer) clearInterval(room.timer);
    room.timeLeft = room.timerDuration;
    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(room.id).emit('timerUpdate', { timeLeft: room.timeLeft, duration: room.timerDuration });

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            room.timer = null;
            io.to(room.id).emit('timerEnd');
        }
    }, 1000);
}

function serializeRoom(room) {
    return {
        id: room.id,
        adminName: room.adminName,
        status: room.status,
        candidates: room.candidates,
        currentIndex: room.currentIndex,
        questionIndex: room.questionIndex,
        questions: room.questions,
        currentQuestion: room.currentQuestion,
        timeLeft: room.timeLeft,
        timerDuration: room.timerDuration,
        history: room.history || []
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`公网访问: https://interview-practice-online1.onrender.com`);
});
