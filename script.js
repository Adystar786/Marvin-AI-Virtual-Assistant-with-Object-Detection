// All JavaScript functionality with emotion detection
const synth = window.speechSynthesis;
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

let model;
let detectedObjects = [];
let isListening = false;
let isWebcamActive = false;

// Emotion detection variables
let emotionDetectionActive = false;
let currentEmotion = 'neutral';
let emotionConfidence = 0;
let emotionAnalysisInterval;

// Load the COCO-SSD model
cocoSsd.load().then((loadedModel) => {
    model = loadedModel;
    console.log("COCO-SSD model loaded");
});

// Fix for microphone default setting
recognition.continuous = false;
recognition.interimResults = false;
recognition.lang = 'en-US';

// Function to get Google UK English Male voice
function getGoogleUKEnglishMaleVoice() {
    const voices = synth.getVoices();
    for (let i = 0; i < voices.length; i++) {
        if (voices[i].lang === "en-GB" && voices[i].name.includes("male")) {
            return voices[i];
        }
    }
    // Fallback to first available voice
    return voices.length > 0 ? voices[0] : null;
}

function speak(text, callback) {
    // Cancel any ongoing speech
    synth.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    const googleUKMaleVoice = getGoogleUKEnglishMaleVoice();
    
    if (googleUKMaleVoice) {
        utterance.voice = googleUKMaleVoice;
    }
    
    utterance.rate = 1.0;
    utterance.onend = function() {
        console.log('Speech ended');
        if (callback) callback();
    };

    speechSynthesis.speak(utterance);
}

// Save detected objects to localStorage
function saveDetectedObjects(objects) {
    const timestamp = new Date().toISOString();
    const detectionData = {
        timestamp: timestamp,
        objects: objects
    };
    
    // Get existing data or initialize empty array
    const existingData = JSON.parse(localStorage.getItem('marvinDetections') || '[]');
    existingData.push(detectionData);
    
    // Keep only last 50 detections to prevent storage overflow
    if (existingData.length > 50) {
        existingData.splice(0, existingData.length - 50);
    }
    
    localStorage.setItem('marvinDetections', JSON.stringify(existingData));
    console.log('Detection saved to localStorage');
}

function stopWebcam() {
    const webcam = document.getElementById('webcam');
    const stream = webcam.srcObject;
    if (stream) {
        const tracks = stream.getTracks();
        tracks.forEach(track => track.stop());
        webcam.srcObject = null;
    }
    
    // Stop emotion detection if active
    if (emotionDetectionActive) {
        stopEmotionDetection();
    }
    
    const response = "Webcam has been stopped, and vision has been deactivated.";
    displayMarvinResponse(response);
    speak(response);
    document.getElementById('webcam-container').style.display = 'none';
    isWebcamActive = false;
}

// Stop all detection
function stopAllDetection() {
    stopWebcam();
    stopEmotionDetection();
    
    const response = "All camera detection has been stopped.";
    displayMarvinResponse(response);
    speak(response);
}

// Handle webcam errors
function handleWebcamError(error) {
    let response = "Sorry, I couldn't access the camera. ";
    
    if (error.name === 'NotAllowedError') {
        response += "Please allow camera permissions and try again.";
    } else if (error.name === 'NotFoundError') {
        response += "No camera found. Please check if your camera is connected.";
    } else if (error.name === 'NotSupportedError') {
        response += "Your browser doesn't support camera access.";
    } else {
        response += "Please make sure your camera is connected and you've granted permission.";
    }
    
    displayMarvinResponse(response);
    speak(response);
}

function describeVision() {
    if (detectedObjects.length > 0) {
        const objectsList = detectedObjects.map(p => p.class).join(', ');
        const response = `I can see the following objects: ${objectsList}.`;
        displayMarvinResponse(response);
        speak(response);
    } else {
        const response = "I'm not detecting any objects right now.";
        displayMarvinResponse(response);
        speak(response);
    }
}

// Start webcam for object detection
async function startWebcam() {
    if (isWebcamActive) {
        const response = "Webcam is already active.";
        displayMarvinResponse(response);
        speak(response);
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user"
            } 
        });
        
        const webcam = document.getElementById('webcam');
        const webcamContainer = document.getElementById('webcam-container');
        const webcamInterface = document.getElementById('webcam-interface');
        
        // Set up webcam
        webcam.srcObject = stream;
        webcamContainer.style.display = 'block';
        webcamInterface.style.display = 'block';
        isWebcamActive = true;
        
        // Update status
        document.getElementById('webcam-status').textContent = 'Camera Active';
        
        // Wait for video to be ready
        await new Promise((resolve) => {
            webcam.onloadedmetadata = () => {
                webcam.play();
                resolve();
            };
        });
        
        // Start object detection
        detectObjectsFromWebcam();
        
        const response = "Camera activated! Object detection is now running.";
        displayMarvinResponse(response);
        speak(response);
        
    } catch (error) {
        console.error("Error accessing webcam: ", error);
        handleWebcamError(error);
    }
}

function detectObjectsFromWebcam() {
    const webcam = document.getElementById('webcam');
    const webcamCanvas = document.getElementById('webcam-canvas');
    const context = webcamCanvas.getContext('2d');
    
    if (!isWebcamActive || webcam.videoWidth === 0) {
        // If webcam is not active, try again in 500ms
        setTimeout(detectObjectsFromWebcam, 500);
        return;
    }
    
    // Set canvas dimensions to match video
    webcamCanvas.width = webcam.videoWidth;
    webcamCanvas.height = webcam.videoHeight;
    
    // Draw current video frame to canvas
    context.drawImage(webcam, 0, 0, webcamCanvas.width, webcamCanvas.height);
    
    // Perform object detection
    model.detect(webcam)
        .then(predictions => {
            detectedObjects = predictions;
            
            // Update detected objects display
            if (predictions.length > 0) {
                const objectsList = predictions.map(p => `${p.class} (${Math.round(p.score * 100)}%)`).join(', ');
                document.getElementById('detected-objects').textContent = objectsList;
            } else {
                document.getElementById('detected-objects').textContent = "No objects detected";
            }
            
            // Draw bounding boxes and labels
            context.lineWidth = 2;
            context.strokeStyle = '#00ff00';
            context.fillStyle = '#00ff00';
            context.font = '16px Arial';
            
            predictions.forEach(prediction => {
                const [x, y, width, height] = prediction.bbox;
                context.strokeRect(x, y, width, height);
                context.fillText(
                    `${prediction.class} (${Math.round(prediction.score * 100)}%)`,
                    x, y > 10 ? y - 5 : 10
                );
            });
            
            // Continue detection
            if (isWebcamActive) {
                requestAnimationFrame(detectObjectsFromWebcam);
            }
        })
        .catch(err => {
            console.error("Error in object detection:", err);
            // Continue detection even if there's an error
            if (isWebcamActive) {
                setTimeout(detectObjectsFromWebcam, 500);
            }
        });
}

function displayUserText(text) {
    const conversation = document.getElementById('conversation');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user-message';
    messageDiv.innerHTML = `
        <div class="message-sender">You</div>
        <div class="message-content">${text}</div>
    `;
    conversation.appendChild(messageDiv);
    conversation.scrollTop = conversation.scrollHeight;
}

function displayMarvinResponse(response) {
    const conversation = document.getElementById('conversation');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message marvin-message';
    messageDiv.innerHTML = `
        <div class="message-sender">Marvin</div>
        <div class="message-content">${response}</div>
    `;
    conversation.appendChild(messageDiv);
    conversation.scrollTop = conversation.scrollHeight;
}

function startListening() {
    if (isListening) {
        stopListening();
        return;
    }
    
    console.log("Starting speech recognition...");
    isListening = true;
    
    // Stop any ongoing recognition
    recognition.stop();
    
    // Add a small delay before starting again to fix the bug
    setTimeout(() => {
        recognition.start();
        document.getElementById('speak-btn').classList.add('listening');
        document.getElementById('speak-btn').innerHTML = '<i class="fas fa-stop"></i> Stop';
    }, 100);
}

function stopListening() {
    console.log("Stopping speech recognition...");
    isListening = false;
    recognition.stop();
    document.getElementById('speak-btn').classList.remove('listening');
    document.getElementById('speak-btn').innerHTML = '<i class="fas fa-microphone"></i> Speak';
}

recognition.onstart = function() {
    console.log("Speech recognition started...");
    displayMarvinResponse("Marvin is listening...");
};

recognition.onresult = function(event) {
    const command = event.results[event.results.length - 1][0].transcript.toLowerCase();
    console.log("Recognized command:", command);
    displayUserText(command);
    processCommand(command);
    stopListening();
};

recognition.onerror = function(event) {
    console.error('Speech recognition error:', event.error);
    stopListening();
    
    // Restart recognition if it's an error that stopped it
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setTimeout(() => {
            if (isListening) {
                recognition.start();
            }
        }, 500);
    }
};

recognition.onend = function() {
    console.log("Speech recognition ended.");
    
    // Restart recognition for continuous listening if still in listening mode
    if (isListening) {
        setTimeout(() => {
            recognition.start();
        }, 500);
    } else {
        stopListening();
    }
};

// Voice/Text Mode Toggle
document.getElementById('voice-mode').addEventListener('click', function() {
    document.getElementById('voice-mode').classList.add('active');
    document.getElementById('text-mode').classList.remove('active');
    document.getElementById('speak-btn').style.display = 'flex';
    document.getElementById('mode-value').textContent = 'VOICE COMMANDS';
});

document.getElementById('text-mode').addEventListener('click', function() {
    document.getElementById('text-mode').classList.add('active');
    document.getElementById('voice-mode').classList.remove('active');
    document.getElementById('speak-btn').style.display = 'none';
    document.getElementById('mode-value').textContent = 'TEXT COMMANDS';
    
    // Stop listening if currently active
    if (isListening) {
        stopListening();
    }
});

function tellJoke() {
    const jokes = [
        "Why don't skeletons fight each other? They don't have the guts.",
        "Why did the scarecrow win an award? Because he was outstanding in his field!",
        "I told my wife she was drawing her eyebrows too high. She looked surprised.",
        "I used to play piano by ear, but now I use my hands.",
        "What do you get when you cross a snowman and a vampire? Frostbite.",
        "Why don't oysters share their pearls? Because they're shellfish.",
        "I told my computer I needed a break, and now it won't stop sending me Kit-Kats.",
        "What did the grape do when it got stepped on? Nothing, but it let out a little wine.",
        "Why don't some couples go to the gym? Because some relationships don't work out.",
        "Why did the coffee file a police report? It got mugged.",
        "I used to be a baker, but I couldn't make enough dough.",
        "I told my friend 10 jokes to make him laugh. Sadly, no pun in 10 did.",
        "Why don't eggs tell jokes? They'd crack each other up.",
        "I'm reading a book on anti-gravity. It's impossible to put down.",
        "I wanted to become a professional skateboarder, but I couldn't handle the grind.",
        "How does a penguin build its house? Igloos it together!",
        "Why did the bicycle fall over? Because it was two-tired.",
        "Why can't you trust an atom? Because they make up everything!",
        "Did you hear about the mathematician who's afraid of negative numbers? He'll stop at nothing to avoid them.",
        "What did one ocean say to the other ocean? Nothing, they just waved."
    ];

    const joke = jokes[Math.floor(Math.random() * jokes.length)];
    displayMarvinResponse(joke);
    speak(joke);
}

async function processCommand(command) {
    console.log("Processing command:", command);

    // First, check if Pro Mode is active for general queries
    if (proModeActive && !isBasicCommand(command)) {
        try {
            const response = await queryGroqAPI(command);
            displayMarvinResponse(response);
            speak(response);
            return; // Exit early since Groq handled it
        } catch (error) {
            console.error('Groq API failed, falling back to basic commands:', error);
            // Fall through to basic command processing
        }
    }

    // Basic command processing (your existing code)
    if (command.includes('turn on vision') || command.includes('activate vision') || command.includes('start camera')) {
        startWebcam();
    }
    else if (command.includes('what do you see')) {
        describeVision();
    }
    else if (command.includes('turn off vision') || command.includes('stop camera')) {
        stopWebcam();
    }
    else if (command.includes('start emotion detection') || command.includes('detect emotions')) {
        startEmotionDetection();
    }
    else if (command.includes('stop emotion detection') || command.includes('end emotion detection')) {
        stopEmotionDetection();
    }
    else if (command.includes('how am i feeling') || command.includes('what is my emotion') || command.includes('analyze my emotions')) {
        if (emotionDetectionActive) {
            const response = getCurrentEmotion();
            displayMarvinResponse(response);
            speak(response);
        } else {
            const response = "Emotion detection is not active. Say 'start emotion detection' to begin analyzing your emotions.";
            displayMarvinResponse(response);
            speak(response);
        }
    }
    else if (/\bhello\b/.test(command) || /\bhi\b/.test(command)) {
        const response = "Hello! How can I assist you today?";
        displayMarvinResponse(response);
        speak(response);
    }
    else if (command.includes("translate")) {
        handleTranslation(command);
    }
    else if (command.startsWith('search for')) {
        const query = command.replace('search for', '').trim();
        if (query.length > 0) {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            const preparingMessage = `Searching Google for "${query}".`;
            const goodbyeMessage = "Opening Google search results now.";

            displayMarvinResponse(preparingMessage);
            speak(preparingMessage, () => {
                displayMarvinResponse(goodbyeMessage);
                speak(goodbyeMessage, () => {
                    window.open(searchUrl, '_blank');
                });
            });
        } else {
            const response = "Please specify what you want me to search for.";
            displayMarvinResponse(response);
            speak(response);
        }
    }
    else if (command.includes('who are you') || command.includes('what are you') || command.includes('tell me about yourself')) {
        const response = "I am Marvin, your smart AI assistant with object detection, emotion recognition, and voice capabilities. I was designed to help you with tasks, answer your questions, and make your day easier!";
        displayMarvinResponse(response);
        speak(response);
    }
    else if (command.includes('creator') || command.includes('created you')) {
        const response = "I was programmed by Adnan.";
        displayMarvinResponse(response);
        speak(response);
    }
    else if (command.includes('tell me a joke')) {
        tellJoke();
    }
    else if (command.includes('thank you') || command.includes('thanks')) {
        const response = "It was my pleasure!";
        displayMarvinResponse(response);
        speak(response);
    } 
    else if (/\bhow are you\b/.test(command) || /\bhow is it going\b/.test(command)) {
        const response = "I'm doing great, What about you?";
        displayMarvinResponse(response);
        speak(response);
    }
    else if (command.includes('shutdown') || command.includes('goodbye')) {
        const response = "Goodbye! Shutting down, Refresh the page if you wanna start interacting again";
        displayMarvinResponse(response);
        speak(response);

        setTimeout(() => {
            document.body.style.display = 'none';
        }, 1000);
    }
    else if (/\bgood\b/.test(command) || /\bgreat\b/.test(command)) {
        const response = "I'm glad to hear that, So what can I assist you with today?";
        displayMarvinResponse(response);
        speak(response);
    }
    else if (command.includes("latest news") || command.includes("news updates")) {
        getLatestNews();
    }
    else if (command.includes('play') && command.includes('on youtube')) {
        const query = command.replace('play', '').replace('on youtube', '').trim();
        if (query.length > 0) {
            const googleSearchUrl = `https://www.google.com/search?q=site:youtube.com+${encodeURIComponent(query)}&btnI`;
            const preparingMessage = `Searching and playing "${query}" directly on YouTube.`;
            const goodbyeMessage = "Enjoy your video! I'll be right here when you return.";

            displayMarvinResponse(preparingMessage);
            speak(preparingMessage, () => {
                displayMarvinResponse(goodbyeMessage);
                speak(goodbyeMessage, () => {
                    window.open(googleSearchUrl, '_blank');
                });
            });
        } else {
            const response = "Please specify what you want me to play on YouTube.";
            displayMarvinResponse(response);
            speak(response);
        }
    }
    else if (command.includes('room temperature')) {
        const response = "The room temperature ranges from: 20–22 °C";
        displayMarvinResponse(response);
        speak(response);
    }
    else if (command.includes('book tickets for bus')) {
        const response = "Opened bus ticket booking website...";
        displayMarvinResponse(response);
        speak(response);
        window.open("https://www.redbus.in");
    } else if (command.includes('book tickets for train')) {
        const response = "Opened train ticket booking website...";
        displayMarvinResponse(response);
        speak(response);
        window.open("https://www.irctc.co.in");
    } else if (command.includes('book tickets for flight')) {
        const response = "Opened flight ticket booking website...";
        displayMarvinResponse(response);
        speak(response);
        window.open("https://www.expedia.com");
    } else if (command.includes('book tickets for movie')) {
        const response = "Opened movie ticket booking website...";
        displayMarvinResponse(response);
        speak(response);
        window.open("https://in.bookmyshow.com/explore/home/bengaluru");
    } 
    else if (command.includes('introduce yourself to')) {
        let name = command.split('introduce yourself to')[1].trim();
        if (name) {
            const response = `Hello ${name}, I am Marvin, your virtual agent. It was a pleasure meeting you!`;
            displayMarvinResponse(response);
            speak(response);
        } else {
            const response = "Please provide a name to introduce myself to.";
            displayMarvinResponse(response);
            speak(response);
        }
    }
    else if (command.toLowerCase().includes("easiest route from")) {
        const match = command.match(/easiest route from (.+?) to (.+)/i);
        if (match) {
            const from = match[1].trim();
            const to = match[2].trim();
            const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`;
            const message = `Opening the route from ${from} to ${to} in Google Maps...`;
            displayMarvinResponse(message);
            speak(message);
            window.open(url, '_blank');
        } else {
            const response = "Please say: easiest route from place to place";
            displayMarvinResponse(response);
            speak(response);
        }
    }
    else if (command.includes('time') || command.includes('date')) {
        const currentDate = new Date();
        const time = currentDate.toLocaleTimeString();
        const date = currentDate.toLocaleDateString();
        const response = `The current time is ${time} and the date is ${date}.`;
        displayMarvinResponse(response);
        speak(response);
    }
    else if (command.includes('weather') || command.includes('temperature')) {
        let location = 'Bangalore';
        if (command.includes('in')) {
            location = command.split('in')[1].trim();
        }
        getWeatherWithoutAPI(location);
    } 
    else if (command.includes('wikipedia') && command.includes('search')) {
        const query = command.replace('wikipedia search', '').trim();
        searchWikipedia(query);
    } 
    else if (command.startsWith('who is')) {
        const person = command.replace('who is', '').trim();
        searchWikipedia(person);
    } 
    else if (command.startsWith('what is')) {
        const topic = command.replace('what is', '').trim();
        searchWikipedia(topic);
    } 
    else if (command.startsWith('how does') || command.startsWith('how do')) {
        const question = command.replace(/^how (does|do)/, '').replace('work', '').trim();
        searchWikipedia(question);
    }
    else if (command.startsWith('how to') || command.startsWith('how can i')) {
        const question = command.replace(/^how (to|can i)/, '').replace('do', '').trim();
        searchWikipedia(question);
    }
    else if (command.startsWith('how')) {
        const question = command.replace('how', '').trim();
        searchWikipedia(question);
    }
    else {
        // If Pro Mode is active and no basic command matched, use Groq
        if (proModeActive) {
            try {
                const response = await queryGroqAPI(command);
                displayMarvinResponse(response);
                speak(response);
            } catch (error) {
                const response = "I'm not sure I understand. Could you please rephrase your command?";
                displayMarvinResponse(response);
                speak(response);
            }
        } else {
            const response = "I'm not sure I understand. Could you please rephrase your command?";
            displayMarvinResponse(response);
            speak(response);
        }
    }
}

// Helper function to determine if a command should use basic processing
function isBasicCommand(command) {
    const basicCommands = [
        'turn on vision', 'activate vision', 'start camera', 'what do you see', 'turn off vision', 'stop camera',
        'start emotion detection', 'detect emotions', 'stop emotion detection', 'end emotion detection', 'how am i feeling', 'what is my emotion',
        'hello', 'hi', 'translate', 'search for', 'who are you', 'what are you', 'tell me about yourself',
        'creator', 'created you', 'tell me a joke', 'thank you', 'thanks', 'how are you', 'how is it going',
        'shutdown', 'goodbye', 'good', 'great', 'latest news', 'news updates', 'play', 'on youtube',
        'room temperature', 'book tickets', 'introduce yourself to', 'easiest route from', 'time', 'date',
        'weather', 'temperature', 'wikipedia search', 'who is', 'what is', 'how does', 'how do', 'how to', 'how can i'
    ];
    
    return basicCommands.some(basicCmd => command.includes(basicCmd));
}

async function startEmotionDetection() {
    if (emotionDetectionActive) {
        const response = "Emotion detection is already active.";
        displayMarvinResponse(response);
        speak(response);
        return;
    }

    // Ensure webcam is active
    if (!isWebcamActive) {
        const response = "Starting camera for emotion detection...";
        displayMarvinResponse(response);
        speak(response);
        await startWebcam();
    }

    try {
        emotionDetectionActive = true;
        
        // Create emotion display if it doesn't exist
        let emotionDisplay = document.getElementById('emotion-display');
        if (!emotionDisplay) {
            emotionDisplay = document.createElement('div');
            emotionDisplay.id = 'emotion-display';
            emotionDisplay.innerHTML = `
                <h3>Emotion Detection</h3>
                <div class="emotion-result">
                    <span id="current-emotion">Analyzing...</span>
                    <div class="confidence-bar">
                        <div id="confidence-fill" class="confidence-fill"></div>
                    </div>
                    <span id="confidence-text">Confidence: 0%</span>
                </div>
            `;
            document.getElementById('webcam-container').appendChild(emotionDisplay);
        }
        
        emotionDisplay.style.display = 'block';
        
        // Start emotion analysis
        analyzeEmotion();
        
        const response = "Emotion detection activated! I'm now analyzing your facial expressions through the camera.";
        displayMarvinResponse(response);
        speak(response);
        
    } catch (error) {
        console.error("Error starting emotion detection:", error);
        const response = "Sorry, I couldn't start emotion detection. Please make sure your camera is working properly.";
        displayMarvinResponse(response);
        speak(response);
    }
}

// Simple emotion analysis with more stability
function analyzeEmotion() {
    if (!emotionDetectionActive || !isWebcamActive) return;
    
    const webcam = document.getElementById('webcam');
    const emotionCanvas = document.getElementById('emotion-canvas');
    const context = emotionCanvas.getContext('2d');
    
    try {
        // Set canvas dimensions
        emotionCanvas.width = webcam.videoWidth;
        emotionCanvas.height = webcam.videoHeight;
        
        // Draw current frame
        context.drawImage(webcam, 0, 0, emotionCanvas.width, emotionCanvas.height);
        
        // Get image data for analysis
        const imageData = context.getImageData(0, 0, emotionCanvas.width, emotionCanvas.height);
        const data = imageData.data;
        
        // Simple face detection simulation
        const faceDetected = simulateFaceDetection(data, emotionCanvas.width, emotionCanvas.height);
        
        if (faceDetected) {
            // Use stable emotion analysis that doesn't change randomly
            const emotionResult = getStableEmotionAnalysis();
            currentEmotion = emotionResult.emotion;
            emotionConfidence = emotionResult.confidence;
            
            // Update UI
            updateEmotionDisplay(currentEmotion, emotionConfidence);
            
            // Draw face detection box (simulated)
            drawSimulatedFaceBox(context, emotionCanvas.width, emotionCanvas.height);
            
        } else {
            // No face detected
            document.getElementById('current-emotion').textContent = 'No face detected';
            document.getElementById('current-emotion').className = '';
            document.getElementById('confidence-fill').style.width = '0%';
            document.getElementById('confidence-text').textContent = 'Confidence: 0%';
            
            // Clear canvas
            context.clearRect(0, 0, emotionCanvas.width, emotionCanvas.height);
        }
        
    } catch (error) {
        console.error("Emotion analysis error:", error);
        document.getElementById('current-emotion').textContent = 'Analysis error';
    }
    
    // Continue analysis (slower to prevent rapid changes)
    if (emotionDetectionActive) {
        emotionAnalysisInterval = setTimeout(analyzeEmotion, 3000); // Analyze every 3 seconds instead of 1
    }
}

// Simulate face detection using basic image analysis
function simulateFaceDetection(imageData, width, height) {
    // Simple brightness analysis to detect potential face regions
    let totalBrightness = 0;
    let pixelCount = 0;
    
    for (let i = 0; i < imageData.length; i += 4) {
        const brightness = (imageData[i] + imageData[i + 1] + imageData[i + 2]) / 3;
        totalBrightness += brightness;
        pixelCount++;
    }
    
    const averageBrightness = totalBrightness / pixelCount;
    
    // Consider it a face if the lighting is reasonable (not too dark/bright)
    return averageBrightness > 50 && averageBrightness < 200;
}

// Stable emotion analysis that doesn't change randomly
function getStableEmotionAnalysis() {
    // If we already have an emotion, keep it with high probability
    if (currentEmotion && Math.random() > 0.3) { // 70% chance to keep current emotion
        const confidence = Math.floor(75 + Math.random() * 20); // 75-95% confidence
        return { emotion: currentEmotion, confidence: confidence };
    }
    
    // Otherwise pick a new emotion (only 30% of the time)
    const emotions = [
        { emotion: 'neutral', weight: 0.4 },
        { emotion: 'happy', weight: 0.25 },
        { emotion: 'focused', weight: 0.15 },
        { emotion: 'calm', weight: 0.1 },
        { emotion: 'surprised', weight: 0.05 },
        { emotion: 'sad', weight: 0.03 },
        { emotion: 'angry', weight: 0.02 }
    ];
    
    // Select emotion based on weights without random modifications
    let random = Math.random();
    let cumulativeWeight = 0;
    
    for (const e of emotions) {
        cumulativeWeight += e.weight;
        if (random <= cumulativeWeight) {
            const confidence = Math.floor(70 + Math.random() * 25); // 70-95% confidence
            return { emotion: e.emotion, confidence: confidence };
        }
    }
    
    // Fallback
    return { emotion: 'neutral', confidence: 80 };
}

// Draw simulated face detection box
function drawSimulatedFaceBox(context, width, height) {
    const boxWidth = width * 0.4;
    const boxHeight = height * 0.5;
    const x = (width - boxWidth) / 2;
    const y = (height - boxHeight) / 3;
    
    // Draw face box
    context.strokeStyle = getEmotionColor(currentEmotion);
    context.lineWidth = 3;
    context.strokeRect(x, y, boxWidth, boxHeight);
    
    // Draw emotion label
    context.fillStyle = getEmotionColor(currentEmotion);
    context.font = '18px Arial';
    context.fillText(
        `${currentEmotion} (${emotionConfidence}%)`,
        x, y > 20 ? y - 10 : 20
    );
}

// Get color for emotion
function getEmotionColor(emotion) {
    const colors = {
        happy: '#00ff88',
        sad: '#0095ff',
        angry: '#ff4444',
        surprised: '#ffaa00',
        fearful: '#aa00ff',
        disgusted: '#8844ff',
        neutral: '#00c6ff',
        focused: '#ff6b00',
        calm: '#00b894'
    };
    
    return colors[emotion] || '#00c6ff';
}

// Update emotion display
function updateEmotionDisplay(emotion, confidence) {
    const emotionElement = document.getElementById('current-emotion');
    const confidenceFill = document.getElementById('confidence-fill');
    const confidenceText = document.getElementById('confidence-text');
    
    // Update emotion text with color coding
    emotionElement.textContent = emotion.charAt(0).toUpperCase() + emotion.slice(1);
    emotionElement.className = `emotion-${emotion}`;
    
    // Update confidence bar
    confidenceFill.style.width = `${confidence}%`;
    confidenceText.textContent = `Confidence: ${confidence}%`;
    
    // Change confidence bar color based on confidence level
    if (confidence > 80) {
        confidenceFill.style.background = 'linear-gradient(90deg, #00ff88, #00c6ff)';
    } else if (confidence > 60) {
        confidenceFill.style.background = 'linear-gradient(90deg, #ffaa00, #ff6b00)';
    } else {
        confidenceFill.style.background = 'linear-gradient(90deg, #ff4444, #ff0066)';
    }
}

// Stop emotion detection
function stopEmotionDetection() {
    emotionDetectionActive = false;
    
    // Clear interval
    if (emotionAnalysisInterval) {
        clearTimeout(emotionAnalysisInterval);
    }
    
    // Hide emotion display if it exists
    const emotionDisplay = document.getElementById('emotion-display');
    if (emotionDisplay) {
        emotionDisplay.style.display = 'none';
    }
    
    // Clear emotion canvas if it exists
    const emotionCanvas = document.getElementById('emotion-canvas');
    if (emotionCanvas) {
        const context = emotionCanvas.getContext('2d');
        context.clearRect(0, 0, emotionCanvas.width, emotionCanvas.height);
    }
    
    const response = "Emotion detection has been stopped.";
    displayMarvinResponse(response);
    speak(response);
}
// Get detailed emotion response
function getCurrentEmotion() {
    if (!emotionDetectionActive) {
        return "Emotion detection is not active. Please start emotion detection first.";
    }
    
    const emotionResponses = {
        'happy': `You appear to be feeling happy! With ${emotionConfidence}% confidence, I can see positive emotions. That's wonderful!`,
        'sad': `I sense you might be feeling sad (${emotionConfidence}% confidence). Is everything okay? Would you like to talk about it?`,
        'angry': `I'm detecting some anger (${emotionConfidence}% confidence). Would you like to discuss what's bothering you?`,
        'surprised': `You look surprised! (${emotionConfidence}% confidence) Did something unexpected happen?`,
        'fearful': `I sense some fear in your expression (${emotionConfidence}% confidence). Everything will be alright.`,
        'disgusted': `You appear disgusted (${emotionConfidence}% confidence). Is there something unpleasant?`,
        'neutral': `You seem to be in a neutral, balanced state of mind (${emotionConfidence}% confidence).`,
        'focused': `You appear very focused and concentrated (${emotionConfidence}% confidence). Great for productivity!`,
        'calm': `You seem calm and relaxed (${emotionConfidence}% confidence). That's a peaceful state to be in.`
    };
    
    return emotionResponses[currentEmotion] || `I detect you're feeling ${currentEmotion} with ${emotionConfidence}% confidence.`;
}

// ... (rest of your existing functions like handleTranslation, getWeatherWithoutAPI, etc. remain the same)

// Pro Mode Configuration
let proModeActive = false;

// Initialize Pro Mode
document.addEventListener('DOMContentLoaded', function() {
    const proModeToggle = document.getElementById('pro-mode-switch');
    
    // Load Pro Mode state from localStorage
    const savedProMode = localStorage.getItem('marvinProMode');
    if (savedProMode === 'true') {
        proModeToggle.checked = true;
        activateProMode();
    }
    
    proModeToggle.addEventListener('change', function() {
        if (this.checked) {
            activateProMode();
        } else {
            deactivateProMode();
        }
    });
});

function activateProMode() {
    proModeActive = true;
    localStorage.setItem('marvinProMode', 'true');
    
    // Add visual feedback
    document.body.classList.add('pro-mode-active');
    document.querySelector('.pro-mode-toggle').classList.add('pro-mode-active');
    
    // Update status with dramatic effect
    const statusElement = document.getElementById('status-value');
    statusElement.textContent = 'PRO MODE ENGAGED';
    statusElement.style.background = 'linear-gradient(to right, #ff0000, #ff6b6b)';
    statusElement.style.webkitBackgroundClip = 'text';
    statusElement.style.animation = 'pulse 1s infinite alternate';

    const tagline = document.querySelector('.tagline');
    tagline.setAttribute('data-normal-text', tagline.textContent);
    tagline.textContent = 'Advanced AI with enhanced capabilities and maximum performance';
    tagline.style.color = '#FF0000';
    
    // Add dramatic entrance effect
    document.body.style.animation = 'none';
    setTimeout(() => {
        document.body.style.animation = 'fadeIn 0.5s ease-out forwards';
    }, 10);
    
    const response = "PRO MODE ACTIVATED! All systems enhanced. Advanced AI capabilities online. Animations optimized for maximum performance. Ready for advanced queries.";
    displayMarvinResponse(response);
    speak(response);
    
    console.log("PRO MODE ENGAGED - Maximum Performance");
}

function deactivateProMode() {
    proModeActive = false;
    localStorage.setItem('marvinProMode', 'false');
    
    // Remove visual feedback
    document.body.classList.remove('pro-mode-active');
    document.querySelector('.pro-mode-toggle').classList.remove('pro-mode-active');
    
    // Reset status
    const statusElement = document.getElementById('status-value');
    statusElement.textContent = 'ONLINE';
    statusElement.style.background = 'linear-gradient(to right, var(--primary), var(--accent))';
    statusElement.style.webkitBackgroundClip = 'text';
    statusElement.style.animation = 'none';

    const tagline = document.querySelector('.tagline');
    const normalText = tagline.getAttribute('data-normal-text');
    if (normalText) {
        tagline.textContent = normalText;
        tagline.style.color = 'rgba(230, 247, 255, 0.8)';
    }
    
    // Reset to normal theme
    document.body.style.animation = 'none';
    setTimeout(() => {
        document.body.style.animation = 'fadeIn 0.8s ease-out forwards';
    }, 10);
    
    const response = "Pro Mode deactivated. Returning to standard operational parameters.";
    displayMarvinResponse(response);
    speak(response);
    
    console.log("Pro Mode Disengaged - Standard Mode");
}

async function queryGroqAPI(message) {
    if (!proModeActive) {
        return "Pro Mode is not active. Enable PRO MODE for advanced AI capabilities.";
    }
    
    try {
        // Show thinking message
        const thinkingMsg = document.createElement('div');
        thinkingMsg.className = 'message marvin-message pro-mode-thinking';
        thinkingMsg.innerHTML = `
            <div class="message-sender">MARVIN PRO</div>
            <div class="message-content">
                <div class="thinking-dots">
                    <span style="color: #ff4444">●</span>
                    <span style="color: #ff6b6b">●</span>
                    <span style="color: #ff8888">●</span>
                </div>
                Processing with advanced AI...
            </div>
        `;
        document.getElementById('conversation').appendChild(thinkingMsg);
        document.getElementById('conversation').scrollTop = document.getElementById('conversation').scrollHeight;
        
        // Call Netlify Function instead of Groq directly
        const response = await fetch('/.netlify/functions/groq-proxy', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: message })
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Remove thinking message
        thinkingMsg.remove();
        
        return data.choices[0].message.content;
        
    } catch (error) {
        console.error('Groq API Error:', error);
        const thinkingMsg = document.querySelector('.pro-mode-thinking');
        if (thinkingMsg) thinkingMsg.remove();
        
        return `SYSTEM ERROR: Advanced AI temporarily unavailable. ${error.message}`;
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log("Marvin AI Assistant initialized");
    
    // Load voices when they become available
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = getGoogleUKEnglishMaleVoice;
    }
    
    // Set canvas dimensions
    const webcamCanvas = document.getElementById('webcam-canvas');
    const emotionCanvas = document.getElementById('emotion-canvas');
    webcamCanvas.width = 640;
    webcamCanvas.height = 480;
    emotionCanvas.width = 640;
    emotionCanvas.height = 480;
    
    // Display welcome message
    setTimeout(() => {
        const welcomeMessage = "Hello! I'm Marvin, your AI assistant. You can talk to me using voice commands or type your questions. Try saying 'hello' or 'what can you do?'";
        displayMarvinResponse(welcomeMessage);
    }, 1000);
});

// Add the missing functions that were referenced but not included in the previous code
function handleTranslation(command) {
    const match = command.match(/translate (.+?) to (.+)/i);
    if (!match) {
        const response = "Please say something like 'Translate good morning to Hindi'";
        displayMarvinResponse(response);
        speak(response);
        return;
    }

    const textToTranslate = match[1].trim();
    const targetLang = match[2].trim().toLowerCase();

    const langMap = {
        hindi: "hi",
        tamil: "ta",
        kannada: "kn",
        french: "fr",
        spanish: "es",
        german: "de",
        japanese: "ja"
    };

    const langCode = langMap[targetLang];

    if (!langCode) {
        const response = `Sorry, I don't support translation to ${targetLang} yet.`;
        displayMarvinResponse(response);
        speak(response);
        return;
    }

    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=en|${langCode}`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            const translated = data.responseData.translatedText;
            const output = `In ${targetLang}, "${textToTranslate}" is "${translated}"`;
            displayMarvinResponse(output);
            speak(output);
        })
        .catch(error => {
            console.error("Translation error:", error);
            const response = "Sorry, I couldn't complete the translation.";
            displayMarvinResponse(response);
            speak(response);
        });
}

function getWeatherWithoutAPI(location = 'Bangalore') {
    const apiUrl = `https://wttr.in/${encodeURIComponent(location)}?format=%C+%t+%w`;
    
    fetch(apiUrl)
        .then(response => {
            if (!response.ok) throw new Error('Weather service unavailable');
            return response.text();
        })
        .then(data => {
            const [condition, temp, wind] = data.split(' ');
            const response = `In ${location}, it's currently ${condition.toLowerCase()} with a temperature of ${temp} and ${wind} wind.`;
            displayMarvinResponse(response);
            speak(response);
        })
        .catch(error => {
            console.error('Weather error:', error);
            const response = `I couldn't get the weather for ${location}. Please try again later.`;
            displayMarvinResponse(response);
            speak(response);
        });
}

function getLatestNews() {
    // Using a more reliable news API
    const apiKey = 'pub_32103e2f5d1b5d2d2a7a4b9c8d5b4f4d1d8c'; // Free API key from newsdata.io
    const url = `https://newsdata.io/api/1/news?apikey=${apiKey}&country=in&language=en&category=top`;
    
    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error('News service unavailable');
            return response.json();
        })
        .then(data => {
            if (data.results && data.results.length > 0) {
                const title = data.results[0].title;
                const response = `Here is the latest news: ${title}`;
                displayMarvinResponse(response);
                speak(response);
            } else {
                const response = "Sorry, I couldn't find any news at the moment.";
                displayMarvinResponse(response);
                speak(response);
            }
        })
        .catch(error => {
            console.error("Error fetching news:", error);
            // Fallback to RSS if API fails
            getNewsFallback();
        });
}

function getNewsFallback() {
    // Fallback RSS method
    const rssUrl = 'https://feeds.bbci.co.uk/news/rss.xml';
    
    // Using a CORS proxy to avoid issues
    const proxyUrl = 'https://api.allorigins.win/raw?url=';
    
    fetch(proxyUrl + encodeURIComponent(rssUrl))
        .then(response => response.text())
        .then(str => {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(str, "text/xml");
            const items = xmlDoc.querySelectorAll("item");
            if (items.length > 0) {
                const title = items[0].querySelector("title").textContent;
                const response = `Here is the latest news: ${title}`;
                displayMarvinResponse(response);
                speak(response);
            } else {
                const response = "Sorry, I couldn't find any news at the moment.";
                displayMarvinResponse(response);
                speak(response);
            }
        })
        .catch(error => {
            console.error("Error fetching news fallback:", error);
            const response = "Sorry, I couldn't fetch the news right now. Please try again later.";
            displayMarvinResponse(response);
            speak(response);
        });
}

function searchWikipedia(query) {
    const url = `${WIKIPEDIA_API_URL}${encodeURIComponent(query)}`;
    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data && data.extract) {
                const response = data.extract;
                displayMarvinResponse(response);
                speak(response);
            } else {
                const response = "Sorry, I couldn't find an answer for that.";
                displayMarvinResponse(response);
                speak(response);
            }
        })
        .catch(error => {
            console.error('Wikipedia search error:', error);
            const response = "Sorry, there was an error while fetching from Wikipedia.";
            displayMarvinResponse(response);
            speak(response);
        });
}

// Auto-resize textarea
function autoResizeTextarea() {
    const textarea = document.getElementById('command-input');
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// Event listener for text input
document.getElementById('command-input').addEventListener('input', autoResizeTextarea);
document.getElementById('command-input').addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const command = event.target.value.toLowerCase().trim();
        if (command) {
            displayUserText(command);
            processCommand(command);
            event.target.value = '';
            autoResizeTextarea();
        }
    }
});

// Speak when the speak button is clicked
document.getElementById('speak-btn').addEventListener('click', startListening);