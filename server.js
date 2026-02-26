const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const users = new Map();

const DEFAULT_QUESTIONS = [
    { id: 1, title: "请自我介绍并谈谈你的优势", desc: "请用2-3分钟时间进行自我介绍，并阐述你为什么适合这个岗位。", image: "https://picsum.photos/600/400?random=1" },
    { id: 2, title: "请描述你最大的缺点", desc: "谈谈你的不足之处，以及你正在如何改进。", image: "https://picsum.photos/600/400?random=2" },
    { id: 3, title: "你为什么想加入我们公司", desc: "请说明你选择我们公司的原因以及你的职业规划。", image: "https://picsum.photos/600/400?random=3" },
    { id: 4, title: "请举例说明你解决困难的经验", desc: "描述一次你面对挑战并成功解决问题的经历。", image: "https://picsum.photos/600/400?random=4" },
    { id: 5, title: "你的期望薪资是多少", desc: "谈谈你的薪酬期望以及理由。", image: "https://picsum.photos/600/400?random=5" }
];

const ADMIN_CREDENTIALS = { username: 'admin', password: 'admin123' };

function createRoom() {
    const roomId = uuidv4().slice(0, 8).toUpperCase();
    const room = {
        id: roomId,
        adminId: null,
        candidates: [],
        currentIndex: 0,
        questionIndex: 0,
        questions: [...DEFAULT_QUESTIONS],
        timerDuration: 300,
        transitionTime: 30,
        status: 'waiting',
        currentQuestion: null,
        timer: null,
        timeLeft: 300
    };
    rooms.set(roomId, room);
    return room;
}

io.on('connection', (socket) => {
    console.log(`用户连接: ${socket.id}`);

    socket.on('createRoom', (data, callback) => {
        const room = createRoom();
        room.adminId = socket.id;
        users.set(socket.id, { roomId: room.id, role: 'admin', name: data.name });
        socket.join(room.id);
        callback({ success: true, room: serializeRoom(room) });
        console.log(`房间创建: ${room.id} by ${data.name}`);
    });

    socket.on('joinRoom', (data, callback) => {
        const room = rooms.get(data.roomId);
        if (!room) {
            callback({ success: false, error: '房间不存在' });
            return;
        }
        if (room.status === 'started') {
            callback({ success: false, error: '考试已开始，无法加入' });
            return;
        }
        if (room.candidates.length >= 20) {
            callback({ success: false, error: '房间已满' });
            return;
        }

        const candidate = {
            id: socket.id,
            name: data.name,
            status: 'waiting',
            score: null,
            feedback: '',
            answer: '',
            muted: false,
            isSpeaking: false
        };
        room.candidates.push(candidate);
        users.set(socket.id, { roomId: room.id, role: 'candidate', name: data.name });
        socket.join(room.id);

        io.to(room.id).emit('roomUpdate', serializeRoom(room));
        callback({ success: true, room: serializeRoom(room) });
        console.log(`${data.name} 加入房间 ${room.id}`);
    });

    socket.on('login', (data, callback) => {
        const user = users.get(socket.id);
        if (!user) {
            callback({ success: false, error: '请先加入房间' });
            return;
        }
        if (data.username === ADMIN_CREDENTIALS.username && data.password === ADMIN_CREDENTIALS.password) {
            user.role = 'admin';
            const room = rooms.get(user.roomId);
            room.adminId = socket.id;
            callback({ success: true });
            io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
        } else {
            callback({ success: false, error: '用户名或密码错误' });
        }
    });

    socket.on('startExam', (callback) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            callback({ success: false, error: '只有管理员可以开始考试' });
            return;
        }
        const room = rooms.get(user.roomId);
        if (room.candidates.length < 1) {
            callback({ success: false, error: '没有考生' });
            return;
        }

        room.status = 'started';
        room.currentIndex = 0;
        room.questionIndex = 0;
        room.currentQuestion = room.questions[0];
        room.timeLeft = room.timerDuration;
        room.candidates.forEach((c, i) => {
            c.status = i === 0 ? 'answering' : 'waiting';
            c.score = null;
        });

        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
        io.to(user.roomId).emit('examStart', { question: room.currentQuestion });
        startTimer(room);
        callback({ success: true });
    });

    socket.on('startAnswer', (callback) => {
        const user = users.get(socket.id);
        if (!user) {
            callback({ success: false, error: '未加入房间' });
            return;
        }
        const room = rooms.get(user.roomId);
        const candidate = room.candidates.find(c => c.id === socket.id);

        if (!candidate) {
            callback({ success: false, error: '未找到考生' });
            return;
        }
        if (candidate.muted) {
            callback({ success: false, error: '已被禁言' });
            return;
        }
        if (candidate.status !== 'waiting') {
            callback({ success: false, error: '当前不是你的答题时间' });
            return;
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

    socket.on('stopAnswer', (callback) => {
        const user = users.get(socket.id);
        if (!user) return;
        const room = rooms.get(user.roomId);

        if (room.timer) {
            clearInterval(room.timer);
            room.timer = null;
        }

        const currentCandidate = room.candidates[room.currentIndex];
        if (currentCandidate) {
            currentCandidate.status = 'completed';
            currentCandidate.isSpeaking = false;

            const score = Math.floor(Math.random() * 30) + 70;
            const feedbacks = [
                '表达清晰有条理，但可以更加自信一些。建议多使用具体案例来支撑你的观点。',
                '整体表现不错，语言流畅。建议在回答问题时更加具体一些，多展示你的实际能力。',
                '回答得很全面，但语速稍快。建议适当停顿，给面试官思考的时间。',
                '思路清晰，回答有针对性。可以增加一些个人特色的表达，让回答更有记忆点。'
            ];
            const answer = `感谢面试官，我叫${currentCandidate.name}，毕业于XX大学XX专业。在校期间，我积累了扎实的专业基础，曾获得XX奖项。毕业后我一直在从事相关工作，积累了丰富的项目经验。我认为自己最大的优势是学习能力强、善于沟通、具备团队协作精神。相信我的能力可以为贵公司创造价值。`;

            currentCandidate.score = score;
            currentCandidate.feedback = feedbacks[Math.floor(Math.random() * feedbacks.length)];
            currentCandidate.answer = answer;
        }

        io.to(user.roomId).emit('answerEnd', { candidate: currentCandidate, score: currentCandidate.score });
        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));

        if (callback) callback({ success: true, candidate: currentCandidate });
    });

    socket.on('nextCandidate', (callback) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            callback({ success: false, error: '只有管理员可以切换' });
            return;
        }
        const room = rooms.get(user.roomId);

        room.currentIndex++;
        room.questionIndex++;

        if (room.currentIndex >= room.candidates.length) {
            room.status = 'finished';
            io.to(user.roomId).emit('examEnd', { candidates: room.candidates });
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
        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
        io.to(user.roomId).emit('candidateChange', { nextCandidate: room.candidates[room.currentIndex].name, question: room.currentQuestion });

        if (callback) callback({ success: true, finished: false });
    });

    socket.on('toggleMute', (data, callback) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            callback({ success: false, error: '只有管理员可以禁言' });
            return;
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
            callback({ success: false, error: '只有管理员可以移除考生' });
            return;
        }
        const room = rooms.get(user.roomId);
        const index = room.candidates.findIndex(c => c.id === data.candidateId);
        if (index > -1) {
            const removed = room.candidates.splice(index, 1)[0];
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
            callback({ success: false, error: '只有管理员可以添加题目' });
            return;
        }
        const room = rooms.get(user.roomId);
        const question = {
            id: Date.now(),
            title: data.title,
            desc: data.desc || '',
            image: `https://picsum.photos/600/400?random=${Date.now()}`
        };
        room.questions.push(question);
        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
        callback({ success: true });
    });

    socket.on('deleteQuestion', (data, callback) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            callback({ success: false, error: '只有管理员可以删除题目' });
            return;
        }
        const room = rooms.get(user.roomId);
        room.questions = room.questions.filter(q => q.id !== data.questionId);
        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
        callback({ success: true });
    });

    socket.on('importQuestions', (data, callback) => {
        const user = users.get(socket.id);
        if (!user || user.role !== 'admin') {
            callback({ success: false, error: '只有管理员可以导入题目' });
            return;
        }
        const room = rooms.get(user.roomId);
        data.questions.forEach(q => {
            room.questions.push({
                id: q.id || Date.now() + Math.random(),
                title: q.title,
                desc: q.desc || '',
                image: q.image || `https://picsum.photos/600/400?random=${Date.now()}`
            });
        });
        io.to(user.roomId).emit('roomUpdate', serializeRoom(room));
        callback({ success: true, count: data.questions.length });
    });

    socket.on('getRoomInfo', (callback) => {
        const user = users.get(socket.id);
        if (!user) {
            callback({ success: false, error: '未加入房间' });
            return;
        }
        const room = rooms.get(user.roomId);
        callback({ success: true, room: serializeRoom(room), user: user });
    });

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            const room = rooms.get(user.roomId);
            if (room) {
                if (user.role === 'admin') {
                    io.to(room.id).emit('adminLeft');
                    rooms.delete(room.id);
                } else {
                    const index = room.candidates.findIndex(c => c.id === socket.id);
                    if (index > -1) {
                        room.candidates.splice(index, 1);
                        if (room.currentIndex >= room.candidates.length) {
                            room.currentIndex = Math.max(0, room.candidates.length - 1);
                        }
                    }
                    io.to(room.id).emit('roomUpdate', serializeRoom(room));
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
        status: room.status,
        candidates: room.candidates,
        currentIndex: room.currentIndex,
        questionIndex: room.questionIndex,
        questions: room.questions,
        currentQuestion: room.currentQuestion,
        timeLeft: room.timeLeft,
        timerDuration: room.timerDuration
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`局域网访问: http://${getLocalIP()}:${PORT}`);
});

function getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}
