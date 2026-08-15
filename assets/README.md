# assets/

Put your exported songs here.

    assets/mysong.wav      <- author with this
    assets/mysong.ogg      <- ship these
    assets/mysong.m4a

Referenced from a level as:

    audio: { src: ['assets/mysong.ogg', 'assets/mysong.m4a'] }

The loader tries each in order and uses the first that decodes.

See ../docs/AUDIO.md for export settings and the alignment workflow.

Audio files are gitignored by default — they're large and usually not
something you want in version control. If you DO want to commit them
(small project, single machine), delete the audio lines from .gitignore.
