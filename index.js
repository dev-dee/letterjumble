'use strict';

var _ = require('lodash');
var Alexa = require('alexa-app');
var Speech = require('ssml-builder');
var Swagger = require('swagger-client');

module.change_code = 1;
_.templateSettings.interpolate = /{{([\s\S]+?)}}/g;

var APP_NAME = 'LetterJumble';
var INTENT_LEVEL = 'LetterJumbleLevel';
var INTENT_GUESS = 'LetterJumbleGuess';
var INTENT_SCORE = 'LetterJumbleScore';
var WORDNET_API_KEY = '3276577be2ae91290e0020d0368094825231c2b7a4fcf6ebb';
var DEFAULT_LEVEL = 3;
var WORD_LIMIT = 50;

var Sentences = {
	PRE_LETTER_ANNOUNCE_REPEAT: 'The letters are',
	PRE_LETTER_ANNOUNCE: 'The letters of the {{count}} {{letter_count}} lettered word are',
	TRY_NEW: 'Do you want to try a new word?',
	INVALID_NUMBER: 'Sorry, I didn\'t hear a valid number.',
	WELCOME: 'Welcome to the Letter Jumble game!',
	GAME_OBJECTIVE: 'Rearrange the letters to find the hidden word.',
	ERROR: 'Sorry, something went wrong! Restarting ...',
	VALID_NUMBER_WARNING: 'You may only pick a number between 3 and 10.',
	SUCCESS_MESSAGE: '{{exclaim}} You scored {{score}} points.',
	FAILURE_MESSAGE: 'Sorry, that was incorrect. The word is {{word}}.',
	WORD_DEFINITION: '{{word}} means {{definition}}.',
	DIFFICULTY_LEVEL: 'Level set at {{level}}.',
	SETTIING_GAME_LEVEL: 'Start by setting the level from 3 to 10.',
	PLAY_DEFAULT_LEVEL: 'Do you want to start playing, level ' + DEFAULT_LEVEL + '?',
	NO_INTENT_FOUND: 'Sorry, I didn\'t understand that.',
	SKIP_TO_NEXT: 'Do you want to skip to the next word?',
	CONTINUE: 'Do you want to continue playing?',
	NOT_A_WORD: 'Sorry, your guess is incorrect. The correct word is {{word}}.',
	TOTAL_SCORE: 'Your score is {{score}}.'
};

var app = new Alexa.app(APP_NAME, 'arn:aws:lambda:us-east-1:543863165587:function:letterjumble');
app.exhaustiveUtterances = true;
app.persistentSession = true;
app.messages.NO_INTENT_FOUND = Sentences.NO_INTENT_FOUND;

var client = null;
var swagger = new Swagger({
	url: 'https://api.apis.guru/v2/specs/wordnik.com/4.0/swagger.json',
	usePromise: true,
	authorizations: {
		api_auth: new Swagger.ApiKeyAuthorization('api_key', WORDNET_API_KEY, 'query')
	}
}).then(function(c) {
	client = c;
	console.log('connected');
}).catch(function(error) {
	console.log('error connecting to api: ' + error);
});

function startGame(res) {
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
	return getRandomWords(level).then(function(data) {
		if(data.obj.length <= 0) {
			return loadWords(DEFAULT_LEVEL);
		}

		var newWords = data.obj.map(function(o) {
			if(o.word.indexOf(' ') === -1 &&
			   o.word.indexOf('-') === -1 &&
			   o.word.indexOf('\'') === -1) {
				return o.word;
			}
		});
		return _.uniq(_.compact(newWords));
    }).catch(function(error) {
		return Promise.reject(error);
	});
}

function setLevel(level, res) {
	console.log('setLevel: ' + level);
	if (level >= 3 && level <= 10) {
		res.session('level', level);
		res.session('words_list', []);
		res.session('game_started', true);
		return startPlaying(level, res);
	} else if(level < 3 || level > 10) {
		res.say(Sentences.VALID_NUMBER_WARNING);
	} else {
		res.say(Sentences.INVALID_NUMBER);
	}
}

function getRandomWords(length) {
	console.log('getRandomWords: ' + length);
	return client.words.getRandomWords({
		hasDictionaryDef: true,
		includePartOfSpeech: ['adverb', 'adjective', 'imperative', 'noun', 'verb', 'verb-intransitive', 'verb-transitive'].join(','),
		// excludePartOfSpeech	: ['article', 'abbreviation', 'affix', 'auxiliary-verb', 'conjunction', 'definite-article', 'family-name', 'given-name', 'idiom', 'interjection', 'noun-plural', 'noun-posessive', 'past-participle', 'pronoun', 'phrasal-prefix', 'preposition', 'proper-noun', 'proper-noun-plural', 'proper-noun-posessive', 'suffix'].join(','),
		minCorpusCount: 0,
		maxCorpusCount: -1,
		minDictionaryCount: 1,
		maxDictionaryCount: -1,
		minLength: length,
		maxLength: length,
		sortBy: 'alpha',
		sortOrder: 'asc',
		limit: WORD_LIMIT
	}, {
		responseContentType: 'application/json'
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
	// console.log('getWordDefinition: ' + word);
	return client.word.getDefinitions({
		word: word,
		limit: 3
	}, {
		responseContentType: 'application/json'
	});
}

function startPlaying(level, res) {
	return loadWords(level).then(function(words) {
		// console.log('startPlaying: ' + words.join(','));
		var shuffledWords = _.shuffle(words);
		var randomWord = _.first(shuffledWords);
		var o = getNextWord(randomWord);

		var wordsList = _.without(shuffledWords, randomWord);		
		var wordsPlayed = [o];
		// console.log('Random Word: ' + randomWord + '/' + wordsList.length);
		res.session('words_list', wordsList);
		res.session('words', wordsPlayed);
		// console.log(o);
		var speechOutput = announceWord(o.shuffled, _.template(Sentences.PRE_LETTER_ANNOUNCE)({ 
			'count': 'first',
			'letter_count': level 
		}));
		res.say(_.template(Sentences.DIFFICULTY_LEVEL)({ 'level': level }));
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
		'count': 'next',
		'letter_count': req.session('level') 
	}));
	res.say(speechOutput).shouldEndSession(false, Sentences.SKIP_TO_NEXT);
	res.session('words_list', wordsList);
	res.session('words', wordsPlayed);
	res.send();
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
		'slots':{'GuessedWord':'AMAZON.LITERAL'},
		'utterances':['{|the} {word|answer} is {-|GuessedWord}']
	},
	function(req, res) {
		var lettersMatch = true;
		var guess = _.toLower(req.slot('GuessedWord'));
		var wordsAttempted = req.session('words');
		wordsAttempted[0].guessTimestamp = Date.now();
		wordsAttempted[0].guesses.push(guess);
		var o = _.first(wordsAttempted);
		var word = _.toLower(o.word);
		var isAlternativeWord = false;
		console.log('Guess/Word: ' + guess + ' / ' + word);

		// _.forEach(guesses, function(guess) {
			if(guess !== word) {
				
				if(guess.length === word.length) {
					for (var i = guess.length - 1; i >= 0; i--) {
						// console.log('Char @ ' + i + ' ' + guess.charAt(i));
						var index = word.indexOf(guess.charAt(i));
						// console.log(index + ' / ' + word);
						if(index === -1) {
							lettersMatch = false;
							break;
						} else {
							word = word.substr(0, index) + word.substr(index+1);
						}
					}
					isAlternativeWord = lettersMatch;
				} else {
					lettersMatch = false;
				}
			}
		// });
		// console.log('Answer: ' + guess + ' : ' + lettersMatch + ' / ' + isAlternativeWord);

		var speech = new Speech();
		var speechOutput;
		if(lettersMatch) {
			getWordDefinition(guess).then(function(data) {
				// console.log('getWordDefinitions: ');
				// console.log(data);
				//If no word definitions are found, its an invalid guess
				var definition;
				if(data.obj.length > 0) {
					definition = _.first(data.obj).text;

					res.card({
					  type: 'Standard',
					  title: guess,
					  text: definition
					});
				} else if(isAlternativeWord) {
					res.say(_.template(Sentences.NOT_A_WORD)({ 'word': o.word }));
					res.send();
					return;
				}

				var score = guess.length * 10;
				speech.say(_.template(Sentences.SUCCESS_MESSAGE)({ 
					'score': score,
					'exclaim': _.first(_.shuffle(['Well done!', 'Nice!', 'That\'s right!', 'Spot on!', 'Correct answer!', 'Excellent!']))
				}));
				speech.say(_.template(Sentences.WORD_DEFINITION)({ 
					'word': guess,
					'definition': definition
				}));
				speechOutput = speech.ssml(true);

				wordsAttempted[0].score = score;
				wordsAttempted[0].bonus = calculateBonus(o);
				res.session('words', wordsAttempted);
				res.say(speechOutput).shouldEndSession(false, Sentences.TRY_NEW);
				
				res.send();
		    }).catch(function(error) {
		    	console.log(error);
		    	res.say(_.template(Sentences.NOT_A_WORD)({ 'word': o.word }));
		    	res.send();
		    });

		    return false;
		} else {
			speech.say(_.template(Sentences.FAILURE_MESSAGE)({ 'word': o.word }));
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
			'count': 'the last',
			'letter_count': req.session('level') 
		}));
		res.say(speechOutput).shouldEndSession(false);
		res.send();
	}
);

app.intent('AMAZON.YesIntent',{
	}, function(req, res) {
		if(!req.session('game_started')) {
			setLevel(DEFAULT_LEVEL, res);
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
		speech.say('Length of words can be controlled, say ');
		speech.pause('1s');
		speech.say('set level followed by a number between 3 and 10');
		speech.say('To answer, say ');
		speech.pause('1s');
		speech.say('the word is followed by your guess');
		var speechOutput = speech.ssml(true);
		res.shouldEndSession(false, speechOutput);
		res.send();
	}
);

app.intent(INTENT_LEVEL,{
		'slots': {'LevelNumber':'AMAZON.NUMBER'},
		'utterances': [
			'set {the |}level {|at |to }{LevelNumber}'
		]
	},
	function(req, res) {
		var level = req.slot('LevelNumber');
		setLevel(level, res);
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
		startGame(res);
	}
)

app.error = function(exception, req, res) {
	var speech = new Speech();
	speech.say(Sentences.ERROR);
	speech.pause('500ms');
    res.say(speech.ssml(true));
    startGame(res);
    res.send();
};

app.sessionEnded(function(request,response) {
    // Clean up the user's server-side stuff, if necessary
    console.log('session ended!');
    // No response necessary
});

app.launch(function(req,res) {
	console.log('launched!');
	startGame(res);
});

exports.handler = app.lambda();
module.exports = app;