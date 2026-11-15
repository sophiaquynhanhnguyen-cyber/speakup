// Nội dung học: rút từ đoạn chat "Cải thiện nghe nói tiếng Anh"
const DATA = {
  daily: [
    { id: 'listen', label: 'Nghe chép clip người nói tự nhiên', min: 15, tab: 'dictation' },
    { id: 'shadow', label: 'Shadowing chính clip vừa nghe', min: 10, tab: 'shadow' },
    { id: 'journal', label: 'Ghi âm nhật ký giọng nói', min: 5, tab: 'free' },
    { id: 'lecture', label: 'Tóm tắt bài giảng hôm nay', min: 2, tab: 'free' },
    { id: 'reflex', label: 'Luyện phản xạ: 3 câu hỏi (thêm)', min: 5, tab: 'reflex' },
  ],
  weekly: [
    { id: 'club', label: 'Câu lạc bộ tiếng Anh (1–2 buổi)', target: 2,
      tip: 'Mục tiêu nhỏ: hỏi mỗi người 1 câu + 1 câu hỏi nối tiếp.' },
    { id: 'tandem', label: 'Tandem 1-1', target: 1,
      tip: 'Tìm một người Bỉ muốn luyện tiếng Anh. 1-1 dễ hơn nói trong nhóm.' },
    { id: 'k432', label: 'Kể chuyện theo kỹ thuật 4-3-2', target: 1, tab: 'free' },
    { id: 'class', label: 'Hỏi/phát biểu trên lớp (mỗi buổi 1 lần)', target: 3 },
    { id: 'measure', label: 'Đo lại 5 chỉ số (mỗi 2 tuần)', target: 1, tab: 'progress', biweekly: true },
  ],
  milestones: [
    { from: 1, to: 4, title: 'Tuần 1–4: thấy rõ thay đổi trong lúc luyện',
      text: 'Nghe chép chính xác hơn 10–15 điểm %. Shadowing đỡ líu lưỡi khi đọc theo. Lần kể thứ 3 của 4-3-2 nhanh hơn lần đầu 15–20%.' },
    { from: 5, to: 8, title: 'Tuần 5–8: bắt đầu thấy ngoài đời',
      text: 'Nghe bạn bè quốc tế hiểu 70–80%. Tốc độ nói tự do tăng 10–15%, số lần ngừng giảm còn khoảng một nửa.' },
    { from: 9, to: 12, title: 'Tuần 9–12: mốc quan trọng',
      text: 'Tóm tắt được hội thoại 10 phút. Trả lời chủ đề quen thuộc không cần soạn trước. Speaking có thể lên ~7.0.' },
    { from: 13, to: 26, title: 'Tháng 4–6: củng cố',
      text: 'Nói tự tin cả chủ đề lạ, quên từ thì tự diễn giải được. Speaking 7.0–7.5 nếu duy trì đều.' },
  ],
  // baseline: mức thường gặp; target: mục tiêu sau 3 tháng; dir: 1 = càng cao càng tốt
  metrics: [
    { id: 'wpm', label: 'Tốc độ nói', unit: 'từ/phút', baseline: '90–110', target: 125, dir: 1, digits: 0 },
    { id: 'pauses', label: 'Ngừng >1 giây', unit: 'lần/phút', baseline: '6–10', target: 3, dir: -1, digits: 1 },
    { id: 'latency', label: 'Bắt đầu nói sau', unit: 'giây', baseline: '3–5', target: 2, dir: -1, digits: 1 },
    { id: 'dict', label: 'Nghe chép chính xác', unit: '%', baseline: '60–70', target: 87, dir: 1, digits: 0 },
    { id: 'recall', label: 'Nhớ ý chính (10 phút)', unit: '/6 ý', baseline: '2–3', target: 5, dir: 1, digits: 0 },
  ],
  connected: [
    { rule: 'Nối phụ âm với nguyên âm (linking)', examples: [
      ['turn it off', 'tur-ni-toff'], ['pick it up', 'pi-ki-tup'], ['an apple', 'a-napple'] ] },
    { rule: 'Rút gọn want to / going to / got to', examples: [
      ['I want to go', 'I wanna go'], ["I'm going to call her", "I'm gonna call her"], ["I've got to leave", "I gotta leave"] ] },
    { rule: 'Nuốt âm /t/, /d/ ở giữa cụm', examples: [
      ['next week', 'nex week'], ['I don\'t know', 'I dunno'], ['last night', 'las night'] ] },
    { rule: 'Biến âm: /t/ + you → "ch", /d/ + you → "j"', examples: [
      ['Did you see it?', 'Didja see it?'], ['What do you want?', 'Whaddaya want?'], ["Don't you think?", 'Doncha think?'] ] },
    { rule: 'Từ chức năng đọc yếu (weak forms)', examples: [
      ['a cup of tea', 'a cuppa tea'], ['fish and chips', 'fish \'n\' chips'], ['Can you help?', 'C\'n you help?'] ] },
    { rule: 'Kiểu nói rút gọn hay gặp khi trò chuyện', examples: [
      ['Do you want to grab a coffee?', 'Wanna grab a coffee?'], ['Are you coming?', 'You coming?'], ['Have you got a minute?', 'Got a minute?'] ] },
  ],
  sampleDictation: "So, I moved here about two years ago, and honestly, the first few months were kind of rough. I didn't really know anyone, and the weather, well, you know what it's like. But then I started going to this language exchange thing on Thursdays, and that's where I met most of my friends now. I'm not gonna lie, I was pretty nervous the first time. I just sat in the corner with my drink. But people were super friendly, and after a while it just got easier.",
  shadowSets: {
    'Trò chuyện thường ngày': [
      ["What are you up to this weekend?", "Whatcha up to this weekend?"],
      ["I'm not really sure yet, maybe I'll just stay in.", ""],
      ["Do you want to grab a coffee after class?", "Wanna grab a coffee after class?"],
      ["I don't know, it kind of depends on the weather.", "I dunno, it kinda depends..."],
      ["Have you been here long?", ""],
      ["Oh, that sounds like a lot of fun!", ""],
      ["I've been meaning to try that place for ages.", ""],
      ["Sorry, I didn't catch that. Could you say it again?", ""],
    ],
    'Câu lạc bộ & làm quen': [
      ["Hi, I don't think we've met. I'm from Vietnam.", ""],
      ["So what brings you to Belgium?", ""],
      ["How long have you been living here?", ""],
      ["That's interesting. How did you get into that?", ""],
      ["What do you miss most about home?", ""],
      ["I know what you mean, it took me a while to get used to it too.", ""],
    ],
    'Trên lớp & thảo luận nhóm': [
      ["Could I just add something to that point?", ""],
      ["I see what you mean, but I'd look at it a bit differently.", ""],
      ["Just to make sure I understood, are you saying that...", ""],
      ["That's a good question. Let me think for a second.", ""],
      ["What I'm trying to say is that it depends on the context.", ""],
      ["Shall we split the work so that each of us takes one part?", ""],
    ],
  },
  reflexQuestions: {
    'Bản thân': [
      'Tell me a little bit about yourself.',
      'What do you usually do after class?',
      'What did you do last weekend?',
      'What are you studying, and why did you choose it?',
      'What kind of music are you into?',
      'Are you a morning person or a night person?',
      'What is something you are proud of?',
      'How do you usually relax when you are stressed?',
    ],
    'Cuộc sống ở Bỉ': [
      'How long have you been in Belgium?',
      'What surprised you the most when you moved here?',
      'What do you miss most about Vietnam?',
      'What is your favourite place in your city?',
      'How is the food here compared to back home?',
      'What do you think about the weather here?',
      'Have you travelled anywhere in Europe yet?',
      'Is it easy to make friends here?',
    ],
    'Học tập': [
      'What was today\'s lecture about?',
      'Which course do you find the most difficult?',
      'Do you prefer working alone or in a group? Why?',
      'What do you want to do after you graduate?',
      'How is studying here different from studying in Vietnam?',
      'What is your dissertation going to be about?',
    ],
    'Quan điểm (khó hơn)': [
      'Do you think social media makes people more lonely?',
      'Should university education be free for everyone?',
      'Is it better to live in a big city or a small town?',
      'Do you think AI will change how we learn languages?',
      'What makes a good teacher?',
      'Should people be allowed to work from home whenever they want?',
      'Is it important to learn about other cultures? Why?',
    ],
  },
  freeTopics: [
    'A typical day in my life in Belgium', 'My hometown', 'Why I came to Belgium',
    'The best trip I have ever taken', 'A person who influenced me', 'My favourite Vietnamese dish',
    'Something I learned recently', 'A difficult decision I made', 'My plans for next year',
    'A funny thing that happened to me', 'What I do to stay healthy', 'A book or film I recommend',
  ],
  phrases: [
    { group: 'Câu giờ khi cần nghĩ', items: [
      ["That's a good question, let me think...", 'Câu hỏi hay, để mình nghĩ'],
      ["Hmm, how can I put this...", 'Nói sao nhỉ...'],
      ["Well, it's hard to say, but...", 'Khó nói lắm, nhưng...'],
      ["I've never really thought about that, but...", 'Chưa nghĩ tới bao giờ, nhưng...'],
      ["Let me see...", 'Để xem nào...'],
    ]},
    { group: 'Diễn giải khi quên từ', items: [
      ["It's the thing you use to...", 'Cái thứ dùng để...'],
      ["It's a kind of...", 'Nó là một loại...'],
      ["What's the word... it's like...", 'Từ gì nhỉ... kiểu như...'],
      ["The opposite of...", 'Ngược lại với...'],
      ["Sorry, the word's on the tip of my tongue.", 'Từ đó ở đầu lưỡi mà không nhớ ra'],
    ]},
    { group: 'Làm rõ ý mình', items: [
      ['What I mean is...', 'Ý mình là...'],
      ['In other words...', 'Nói cách khác...'],
      ['Let me put it another way.', 'Để mình nói kiểu khác'],
      ['The main point is...', 'Ý chính là...'],
    ]},
    { group: 'Khi không nghe rõ', items: [
      ["Sorry, I didn't catch that.", 'Xin lỗi, mình nghe không kịp'],
      ['Could you say that again?', 'Bạn nói lại được không?'],
      ['Do you mean...?', 'Ý bạn là...?'],
      ['Sorry, what was the last part?', 'Đoạn cuối là gì vậy?'],
    ]},
    { group: 'Câu hỏi nối tiếp (cho club)', items: [
      ['Oh really? How come?', 'Thật à? Sao vậy?'],
      ['What was that like?', 'Cảm giác thế nào?'],
      ['How did you get into that?', 'Sao bạn lại bắt đầu làm việc đó?'],
      ['And what happened next?', 'Rồi sao nữa?'],
      ['Would you do it again?', 'Bạn có làm lại không?'],
    ]},
    { group: 'Bắt chuyện', items: [
      ["Hi, I don't think we've met. I'm...", 'Chào, hình như mình chưa gặp nhau'],
      ['Is this your first time here?', 'Lần đầu bạn đến đây à?'],
      ['How do you know the others?', 'Bạn quen mọi người thế nào?'],
      ['So what do you do?', 'Bạn làm gì?'],
    ]},
  ],
  flashTopics: {
    'Food & cooking': { vocab: ['comfort food', 'a sweet tooth', 'home-cooked', 'grab a bite', 'spicy / bland'], questions: [
      'What did you have for breakfast today?', 'What is a dish you could eat every day?', 'Do you prefer cooking at home or eating out?',
      'What food would you never try?', 'If you opened a restaurant, what would you serve?'] },
    'Travel': { vocab: ['off the beaten track', 'a getaway', 'jet lag', 'sightseeing', 'travel light'], questions: [
      'Where would you go if you could travel anywhere tomorrow?', 'Do you prefer beach holidays or city trips?', 'What is the worst trip you have ever had?',
      'Would you rather travel alone or with friends?', 'What is one place everyone should visit once?'] },
    'Technology': { vocab: ['addicted to my phone', 'screen time', 'user-friendly', 'keep up with', 'go offline'], questions: [
      'How much time do you spend on your phone every day?', 'Which app could you not live without?', 'Could you live without the internet for a week?',
      'What invention do you think changed the world the most?', 'Do you think robots will do most jobs in the future?'] },
    'Weather & seasons': { vocab: ['chilly', 'pouring with rain', 'a heatwave', 'gloomy', 'cosy'], questions: [
      'What is your favourite season and why?', 'How does the weather affect your mood?', 'What do you like to do on a rainy day?',
      'Would you rather live somewhere always hot or always cold?', 'What was the weather like where you grew up?'] },
    'Hobbies & free time': { vocab: ['unwind', 'take up a hobby', 'be into something', 'kill time', 'binge-watch'], questions: [
      'What do you usually do to relax?', 'Is there a hobby you would like to take up?', 'What did you do last weekend?',
      'Do you prefer indoor or outdoor activities?', 'What is something you are really good at?'] },
    'Childhood': { vocab: ['grow up', 'look back on', 'mischievous', 'a vivid memory', 'when I was a kid'], questions: [
      'What is your favourite childhood memory?', 'What did you want to be when you were a child?', 'What games did you play as a kid?',
      'Who was your best friend at primary school?', 'Do you think children today have a better life than you did?'] },
    'Money & shopping': { vocab: ['on a budget', 'splash out', 'a bargain', 'impulse buy', 'save up for'], questions: [
      'What was the last thing you bought?', 'Are you a saver or a spender?', 'Do you prefer shopping online or in stores?',
      'What would you do if you won a million euros?', 'What is something that is worth spending more money on?'] },
    'Health & lifestyle': { vocab: ['stay in shape', 'work out', 'a balanced diet', 'burn out', 'get enough sleep'], questions: [
      'What do you do to stay healthy?', 'Are you a morning person or a night owl?', 'How many hours do you usually sleep?',
      'What is a bad habit you would like to break?', 'How do you deal with stress?'] },
    'Environment': { vocab: ['go green', 'cut down on', 'single-use plastic', 'carbon footprint', 'recycle'], questions: [
      'What do you do to help the environment?', 'Should plastic bags be banned everywhere?', 'Would you give up flying to protect the planet?',
      'Is it the job of governments or individuals to stop climate change?', 'What is the biggest environmental problem in your country?'] },
    'Work & future': { vocab: ['a dream job', 'work-life balance', 'climb the ladder', 'be my own boss', 'in the long run'], questions: [
      'What would your dream job be?', 'Would you rather work from home or in an office?', 'Where do you see yourself in five years?',
      'Is money the most important thing in a job?', 'What skill do you want to learn this year?'] },
    'Films, music & books': { vocab: ['a page-turner', 'catchy', 'plot twist', 'it grew on me', 'highly recommend'], questions: [
      'What is the last film you watched?', 'What kind of music do you listen to when you study?', 'Is there a book that changed the way you think?',
      'Do you prefer watching films at home or at the cinema?', 'Which song always puts you in a good mood?'] },
    'Hypothetical': { vocab: ['I\'d probably...', 'if I had the chance', 'without a doubt', 'it depends', 'the first thing I\'d do'], questions: [
      'If you could have any superpower, what would it be?', 'If you could meet anyone, dead or alive, who would it be?', 'If you could live in any period of history, which would you choose?',
      'If you had one extra hour every day, how would you use it?', 'If you could change one thing about the world, what would it be?'] },
  },
  flashStarters: ["Honestly, I'd say...", 'That\'s a tough one, but...', 'I\'ve never really thought about it, but...', 'It depends, but generally...', 'For me, it\'s definitely...'],
  stories: [
    { id: 'home', title: 'Quê nhà', prompt: 'Where are you from? What is it like? What do you miss?' },
    { id: 'study', title: 'Ngành học', prompt: 'What do you study? Why? What is your research about?' },
    { id: 'why', title: 'Vì sao sang Bỉ', prompt: 'Why Belgium? How did you decide? First impressions?' },
    { id: 'life', title: 'Cuộc sống ở Bỉ', prompt: 'A typical day, food, weather, culture shock, funny moments.' },
    { id: 'hobby', title: 'Sở thích', prompt: 'What do you do in your free time? How did you start?' },
    { id: 'future', title: 'Kế hoạch tương lai', prompt: 'What will you do after graduating? Where do you see yourself?' },
  ],
};
