'use strict';

var _ = require('lodash');
var Alexa = require('alexa-app');
var Speech = require('ssml-builder');
var request = require('request-json');
var md5 = require("nodejs-md5");

module.change_code = 1;
_.templateSettings.interpolate = /{{([\s\S]+?)}}/g;

var APP_NAME = 'LetterJumble';
var INTENT_LEVEL = 'LetterJumbleLevel';
var INTENT_GUESS = 'LetterJumbleGuess';
var INTENT_SCORE = 'LetterJumbleScore';
var isLocal = true;
var levelDifficulty = { EASY:'EASY', MEDIUM: 'MEDIUM', HARD: 'HARD' };
var DEFAULT_LEVEL = levelDifficulty.EASY;
var SUCCESS_EXCLAIM = ['Well done!', 'Nice!', 'That\'s right!', 'Spot on!', 'Correct answer!', 'Excellent!'];
var COUNTRIES_URL = 'https://restcountries.eu/rest/v1/all';
var WIKI_API_URL = 'https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=&explaintext=&titles={{keyword}}';
var WIKI_IMAGES_URL = 'https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=&explaintext=&titles={{keyword}}&prop=images';

var Sentences = {
	WIKI_FACT: 'Fact from Wiki about {{word}}: {{fact}}',
	HEARD_YOU_SAY: 'You said {{word}}',
	PRE_LETTER_ANNOUNCE_REPEAT: 'The letters are',
	PRE_LETTER_ANNOUNCE: 'The letters of the {{count}} word are',
	TRY_NEW: 'Do you want to try a new word?',
	WELCOME: 'Welcome to the Letter Jumble game!',
	GAME_OBJECTIVE: 'Rearrange the letters to find the hidden word.',
	ERROR: 'Sorry, something went wrong! Restarting ...',
	SUCCESS_MESSAGE: '{{exclaim}} You scored {{score}} points.',
	DIFFICULTY_LEVEL: 'Nice, you will be presented {{count}} letter words.',
	SETTIING_GAME_LEVEL: 'Start by setting the level to ' + levelDifficulty.EASY + ', ' + levelDifficulty.MEDIUM + ' or ' + levelDifficulty.HARD + '.',
	PLAY_DEFAULT_LEVEL: 'Do you want to start playing, level ' + DEFAULT_LEVEL + '?',
	NO_INTENT_FOUND: 'Sorry, I didn\'t understand that.',
	SKIP_TO_NEXT: 'Do you want to skip to the next word?',
	CONTINUE: 'Do you want to continue playing?',
	NOT_A_WORD: 'Sorry, you said {{guess}}. However, that is incorrect. The word is {{word}}.',
	TOTAL_SCORE: 'Your score is {{score}}.'
};

var app = new Alexa.app(APP_NAME, !isLocal ? 'arn:aws:lambda:us-east-1:543863165587:function:letterjumble' : 'letterjumble');
app.exhaustiveUtterances = false;
app.persistentSession = true;
app.messages.NO_INTENT_FOUND = Sentences.NO_INTENT_FOUND;

var client = request.createClient('');

function startGame(req, res) {
	res.session('game_started', false);
	var speech = new Speech();
	speech.say(Sentences.GAME_OBJECTIVE);
	speech.pause('250ms');
	speech.say(Sentences.SETTIING_GAME_LEVEL);
	var speechOutput = speech.ssml(true);
	res.say(speechOutput).shouldEndSession(false, Sentences.PLAY_DEFAULT_LEVEL);
}

function endGame(res) {
	res.clearSession();
	res.shouldEndSession(true);
	res.send();
}

function announceWord(word, preText) {
	// console.log('announceWord: ' + word + ' / ' + preText);
	var speech = new Speech();
	speech.say(preText);
	for(var i = 0; i < word.length; i++) {
		speech.pause('250ms');
		speech.say(word[i]);
	}
	return speech.ssml(true);
}

function loadWords(level) {
	return getCountries().then(function(data) {
		return _.compact(data.map(function(country) {
			if(country.name.length >= level.min && country.name.length <= level.max) {
				return country.name;
			}
		}));
    }).catch(function(error) {
		return Promise.reject(error);
	});
}

function setLevel(level, req, res) {
	console.log('setLevel: ' + level);
	res.session('level', level);
	res.session('words_list', []);
	res.session('game_started', true);
	return startPlaying(level, req, res);
}

function getCountries() {
	console.log('getCountries');
	return new Promise(function(resolve, reject) {
		client.get(COUNTRIES_URL, {}, function(err, res, body) {
			var countries = body.map(function(country) {
				if(country.name.indexOf(' ') === -1) {
					return _.pick(country, ['name', 'capital', 'population', 'demonym'])
				}
			});
			resolve(_.compact(countries));
		});
	});
}

function getNextWord(randomWord) {
	console.log('getNextWord: ' + randomWord);
	var shuffledWord = _.shuffle(randomWord.toUpperCase().split(''));
	return {
		id: _.uniqueId('word_'),
		word: randomWord,
		shuffled: shuffledWord,
		score: 0,
		timestamp: Date.now(),
		guessTimestamp: 0,
		bonus: 0,
		guesses: []
	};
}

function calculateBonus(o) {
	var time = o.guessTimestamp - o.timestamp;
	var timeInSecs = Math.round(time/1000);
	if(timeInSecs <= 15) {
		return o.word.length * 5;
	} else if(timeInSecs > 15 && timeInSecs < 30) {
		return o.word.length * 2;
	} else {
		return 0;
	}
}

function getWordDefinition(word) {
	console.log('getWordDefinition: ' + word);
	return new Promise(function(resolve, reject) {
		client.get(_.template(WIKI_API_URL)({
			'keyword': word
		}), {}, function(err, res, body) {
			var key = _.first(_.keys(body.query.pages));
			var extract = body.query.pages[key.toString()]['extract'];
			var sentences = extract.split('. ');

			client.get(_.template(WIKI_IMAGES_URL)({
				'keyword': word
			}), {}, function(err, res, body) {
				var images = body.query.pages[key.toString()]['images'];
				var imageURL = _.replace(_.first(_.shuffle(images)).title.split(':')[1], new RegExp(' ', 'g'), '_');
				// console.log(imageURL);
				md5.string.quiet(imageURL, function (err, md5) {
					if(!err) {
						// console.log(md5);
						var directory = md5.charAt(0) + '/' + md5.substr(0, 2) + '/';
						// console.log(directory);
						var fullURL = 'https://upload.wikimedia.org/wikipedia/commons/' + directory + imageURL;
						// console.log(fullURL);
						resolve({
							image: fullURL,
							text: sentences[_.random(1, sentences.length)],
							fullText: extract
						});
					}
				});
			});
		});
	});
}

function startPlaying(level, req, res) {
	return loadWords(level).then(function(words) {
		// console.log('startPlaying: ' + words.join(','));
		var shuffledWords = _.shuffle(words);
		var randomWord = _.first(shuffledWords);
		var o = getNextWord(randomWord);

		var wordsList = _.without(shuffledWords, randomWord);		
		var wordsPlayed = req.session('words');
		wordsPlayed.unshift(o);
		// console.log('Random Word: ' + randomWord + '/' + wordsList.length);
		res.session('words_list', wordsList);
		res.session('words', wordsPlayed);
		// console.log(o);
		var speechOutput = announceWord(o.shuffled, _.template(Sentences.PRE_LETTER_ANNOUNCE)({ 
			'count': 'first'
		}));
		res.say(speechOutput).shouldEndSession(false);
		res.send();
	}).catch(function(error) {
		console.log(error);
	});
}

function askNextWord(req, res) {
	var shuffledWords = req.session('words_list');
	var randomWord = _.first(shuffledWords);
	var o = getNextWord(randomWord);

	var wordsList = _.without(shuffledWords, randomWord);
	var wordsPlayed = req.session('words');
	wordsPlayed.unshift(o);
	// console.log('askNextWord:: ' + randomWord + ' - ' + wordsList.length + '/' + wordsPlayed.length);
	// console.log(o);
	var speechOutput = announceWord(o.shuffled, _.template(Sentences.PRE_LETTER_ANNOUNCE)({ 
		'count': 'next'
	}));
	res.say(speechOutput).shouldEndSession(false, Sentences.SKIP_TO_NEXT);
	res.session('words_list', wordsList);
	res.session('words', wordsPlayed);
	res.send();
}

function getWordSizeByLevel(levelType) {
	console.log('getWordSizeByLevel: ' + levelType);
	var level = { min: 0, max: 0 };
	switch(levelType.toUpperCase()) {
		case levelDifficulty.EASY:
			level.min = 3;
			level.max = 6;
			break;

		case levelDifficulty.MEDIUM:
			level.min = 7;
			level.max = 9;
			break;

		case levelDifficulty.HARD:
			level.min = 10;
			level.max = Number.POSITIVE_INFINITY;
			break;
	}
	return level;
}

app.intent(INTENT_SCORE,{
		'utterances':['{What is|Tell me|What\'s|Get} {my|the} score']
	},
	function(req, res) {
		var wordsAttempted = req.session('words');
		var totalScore = _.reduce(wordsAttempted, function(result, o, key) {
			// console.log(o.score + ' / ' + o.bonus);
			return result + (o.score + o.bonus);
		}, 0);
		console.log('Total score: ' + totalScore);
		res.say(_.template(Sentences.TOTAL_SCORE)({ 'score': totalScore })).shouldEndSession(false, Sentences.CONTINUE);
		res.send();
	}
);

app.intent(INTENT_GUESS,{
		'slots':{
			'CountryName':'AMAZON.Country'
		},
		'utterances':[
			'the country is {CountryName}'
		]
	},
	function(req, res) {
		var lettersMatch = true;
		var guess = _.toLower(req.slot('CountryName'));
		var wordsAttempted = req.session('words');
		wordsAttempted[0].guessTimestamp = Date.now();
		wordsAttempted[0].guesses.push(guess);
		var o = _.first(wordsAttempted);
		var word = _.toLower(o.word);

		var speech = new Speech();
		var speechOutput;
		if(guess === word) {
			getWordDefinition(guess).then(function(data) {
				console.log('getWordDefinitions: ');
				console.log(data);

				var score = guess.length * 10;
				speech.say(_.template(Sentences.SUCCESS_MESSAGE)({ 
					'score': score,
					'exclaim': _.first(_.shuffle(SUCCESS_EXCLAIM))
				}));
				speech.say(_.template(Sentences.WIKI_FACT)({
					'word': word,
					'fact': data.text
				}));
				speechOutput = speech.ssml(true);

				wordsAttempted[0].score = score;
				wordsAttempted[0].bonus = calculateBonus(o);
				res.session('words', wordsAttempted);
				res.say(speechOutput).shouldEndSession(false, Sentences.TRY_NEW);

				var cardData = {
					type: 'Standard',
					title: _.capitalize(word),
					text: data.text
				};
				if(data.image) {
					cardData.image = {
						largeImageUrl: data.image
					}
				}

				res.card(cardData);
				
				res.send();
		    }).catch(function(error) {
		    	console.log(error);
		    	res.say(_.template(Sentences.NOT_A_WORD)({ 
		    		'guess': guess,
		    		'word': o.word 
		    	}));
		    	res.send();
		    });

		    return false;
		} else {
			speech.say(_.template(Sentences.NOT_A_WORD)({
				'guess': guess,
				'word': o.word
			}));
			speechOutput = speech.ssml(true);
			res.say(speechOutput).shouldEndSession(false, Sentences.TRY_NEW);
			res.send();
		}
	}
);

app.intent('AMAZON.RepeatIntent',{
	},
	function(req,res) {

		var wordsPlayed = req.session('words');
		var o = _.first(wordsPlayed);

		var speechOutput = announceWord(o.shuffled, _.template(Sentences.PRE_LETTER_ANNOUNCE)({ 
			'count': 'the last'
		}));
		res.say(speechOutput).shouldEndSession(false);
		res.send();
	}
);

app.intent('AMAZON.YesIntent',{
	}, function(req, res) {
		if(!req.session('game_started')) {
			setLevel(getWordSizeByLevel(DEFAULT_LEVEL), req, res);
			return false;
		} else {
			askNextWord(req, res);
		}
	}
);

app.intent('AMAZON.NextIntent',{
	}, function(req, res) {
		askNextWord(req, res);
	}
);

app.intent('AMAZON.HelpIntent',{
	
	},
	function(req,res) {
		var speech = new Speech();
		speech.say(Sentences.GAME_OBJECTIVE);
		var speechOutput = speech.ssml(true);
		res.shouldEndSession(false, speechOutput);
		res.send();
	}
);

app.intent(INTENT_LEVEL,{
		'slots': {'LevelType':'DIFFICULTY_LEVEL'},
		'utterances': [
			'set {the |}level {|to }{|LevelType}'
		]
	},
	function(req, res) {
		var level = req.slot('LevelType');
		setLevel(getWordSizeByLevel(level), req, res);
		return false;
	}
);

app.intent('AMAZON.NoIntent',{
	},
	function(req, res) {
		endGame(res);
	}
);

app.intent('AMAZON.StopIntent',{
	},
	function(req, res) {
		endGame(res);
	}
);

app.intent('AMAZON.StartOverIntent',{
	},
	function(req, res) {
		res.clearSession();
		startGame(req, res);
	}
)

app.error = function(exception, req, res) {
	var speech = new Speech();
	speech.say(Sentences.ERROR);
	speech.pause('500ms');
    res.say(speech.ssml(true));
    startGame(req, res);
    res.send();
};

app.sessionEnded(function(request,response) {
    // Clean up the user's server-side stuff, if necessary
    console.log('session ended!');
    // No response necessary
});

app.launch(function(req,res) {
	console.log('launched!');
	res.session('words', []);
	startGame(req, res);
});

exports.handler = app.lambda();
module.exports = app;