var Steppe = (function(Steppe) {
    Steppe.Renderer = function(canvas, undefined) {
        var _CANVAS_WIDTH        = 320,	// 320 pixels
            _CANVAS_HEIGHT       = 200,	// 200 pixels
            _ANGLE_OF_VIEW       = 60,	// 60 degrees
            _ONE_DEGREE_ANGLE    = 1 / _ANGLE_OF_VIEW * _CANVAS_WIDTH,
            _THIRTY_DEGREE_ANGLE = _ONE_DEGREE_ANGLE * 30,
            _THREE_HUNDRED_AND_SIXTY_DEGREE_ANGLE = _ONE_DEGREE_ANGLE * 360,
            _ANGULAR_INCREMENT   = _ANGLE_OF_VIEW / _CANVAS_WIDTH,
            _DEGREES_TO_RADIANS  = Math.PI / 180,
            _FAKE_DEGREES_TO_RADIANS = (2 * Math.PI) /
                ((360 / _ANGLE_OF_VIEW) * _CANVAS_WIDTH),
            _RADIANS_TO_DEGREES  = 180 / Math.PI,
            _RADIANS_TO_FAKE_DEGREES = ((360 / _ANGLE_OF_VIEW) *
                _CANVAS_WIDTH) / (2 * Math.PI),
            _SCALE_FACTOR = 35,
            _CAMERA_Y     = 175,
            _DISTANCE     = 75,
            _REAL_DISTANCE = Math.abs(1 / Math.tan(_ANGLE_OF_VIEW / 2) *
                _CANVAS_WIDTH / 2),
            _VERTICAL_FIELD_OF_VIEW = Math.round(2 * Math.atan(
                (_CANVAS_HEIGHT / 2) / _DISTANCE) * _RADIANS_TO_DEGREES),
            _WATER_HEIGHT = 64;

//        console.log('_REAL_DISTANCE = ' + _REAL_DISTANCE);
//        console.log('_VERTICAL_FIELD_OF_VIEW = ' + _VERTICAL_FIELD_OF_VIEW);

        var _FASTEST   = 4,
            _DONT_CARE = 2,
            _NICEST    = 1;

        var _camera = { angle: 0, x: 0, y: _CAMERA_Y, z: 0 },
            _cosineLookupTable = [],
            _framebuffer = undefined,
            _heightmap = [],
            _inverseDistortionLookupTable = [],
            _outOfBoundsHeightmap = [],
            _outOfBoundsTexturemap = undefined,
            _rayLengthLookupTable = [],
            _sineLookupTable = [],
            _sky = undefined,
            _spriteList = [],
            _texturemap = undefined,
            _visibleSpriteList = [];

        var _fog = false,		// disabled (default)
            _quality = _DONT_CARE,	// medium quality (default)
            _smooth = 0,		// disabled (default)
            _waterHeight = -1;	// disabled (default)

        /**
         * Blend two colours together using an alpha value.
         *
         * @param {object} firstColor First (or source) colour.
         * @param {object} secondColor Second (or destination) colour.
         * @param {number} alpha Alpha value in the range 0..255.
         * @return {object} Mixed colour.
         */
        var _alphaBlend = function(firstColor, secondColor, alpha)
        {
            if (alpha < 0) {
                alpha = 0;
            } else if (alpha > 255) {
                alpha = 255;
            }

            var normalisedAlpha = alpha / 255,
                adjustedAlpha = 1 - normalisedAlpha;

            var mixedRed   = firstColor.red   * normalisedAlpha | 0,
                mixedGreen = firstColor.green * normalisedAlpha | 0,
                mixedBlue  = firstColor.blue  * normalisedAlpha | 0;

            mixedRed   += Math.floor(secondColor.red   * adjustedAlpha);
            mixedGreen += Math.floor(secondColor.green * adjustedAlpha);
            mixedBlue  += Math.floor(secondColor.blue  * adjustedAlpha);

            return { red: mixedRed, green: mixedGreen, blue: mixedBlue };
        };

        /**
         * Get a pixel from the out-of-bounds texturemap.
         *
         * @param {number} x ...
         * @param {number} y ...
         * @return {object} ...
         */
        var _getPixelFromOutOfBoundsTexturemap = function(x, y) {
            if (_outOfBoundsTexturemap !== undefined) {
                var index = (y << 12) + (x << 2);

                return {
                    red:   _outOfBoundsTexturemap[index],
                    green: _outOfBoundsTexturemap[index + 1],
                    blue:  _outOfBoundsTexturemap[index + 2]
                };
            } else {
                return {
                    red:   127,
                    green: 127,
                    blue:  127
                };
            }
        };

        /**
         * ...
         *
         * @param {number} x ...
         * @param {number} y ...
         * @return {object} ...
         */
        var _getPixelFromSky = function(x, y) {
            var currentAngle = _camera.angle - _THIRTY_DEGREE_ANGLE;

            if (currentAngle < 0) {
                currentAngle += _THREE_HUNDRED_AND_SIXTY_DEGREE_ANGLE;
            }

            if (y < 0) {
                y = 0;
            } else if (y >= 100) {
                y = 100 - 1;
            }

            var data = _sky.getContext('2d').getImageData(
                (currentAngle + x | 0) % 1920, y, 1, 1).data;

            return { red: data[0], green: data[1], blue: data[2] };
        };

        /**
         * ...
         *
         * @param {number} x ...
         * @param {number} y ...
         * @return {object} ...
         */
        var _getPixelFromTexturemap = function(x, y) {
            var index = (y << 12) + (x << 2);

            return {
                red:   _texturemap[index],
                green: _texturemap[index + 1],
                blue:  _texturemap[index + 2]
            };
        };

        /**
         * Initialise the inverse distortion lookup table (for removing
         * fisheye).
         */
        var _initInverseDistortionLookupTable = function() {
            for (var angleOfRotation = 0;
                angleOfRotation < _THIRTY_DEGREE_ANGLE;
                ++angleOfRotation) {
                var angleOfRotationInRadians = angleOfRotation *
                    _ANGULAR_INCREMENT * _DEGREES_TO_RADIANS;

                _inverseDistortionLookupTable[angleOfRotation +
                    _THIRTY_DEGREE_ANGLE] = 1 /
                    Math.cos(angleOfRotationInRadians);
                _inverseDistortionLookupTable[
                    _THIRTY_DEGREE_ANGLE - angleOfRotation] = 1 /
                    Math.cos(angleOfRotationInRadians);
            }
        };

        /**
         * Initialise (or recalculate) the ray-length lookup table.
         *
         * @param {number} y ...
         * @param {number} distance ...
         */
        var _initRayLengthLookupTable = function(y, distance) {
            for (var ray = 1; ray < 320; ++ray) {
                for (var row = 50; row < 200 + 100; ++row) {
                    var invertedRow = 200 - row;

                    var rayLength = _inverseDistortionLookupTable[ray] *
                        ((distance * y) / (y - invertedRow));

                    _rayLengthLookupTable[row * 320 + ray] = rayLength;
                }
            }
        };

        /**
         * Initialise the sine and cosine lookup tables.
         */
        var _initSineAndCosineLookupTables = function() {
            for (var angleOfRotation = 0;
                angleOfRotation < _THREE_HUNDRED_AND_SIXTY_DEGREE_ANGLE;
                ++angleOfRotation) {
                var angleOfRotationInRadians = angleOfRotation *
                    _ANGULAR_INCREMENT * _DEGREES_TO_RADIANS;

                _sineLookupTable[angleOfRotation]   = Math.sin(
                    angleOfRotationInRadians);
                _cosineLookupTable[angleOfRotation] = Math.cos(
                    angleOfRotationInRadians);
            }
        };

        /**
         * Render the 360-degree panoramic sky based on the camera's angle
         * of rotation.
         */
        var _renderSky = function() {
            var angleOfRotation = _camera.angle - _THIRTY_DEGREE_ANGLE;

            if (angleOfRotation < 0) {
                angleOfRotation += _THREE_HUNDRED_AND_SIXTY_DEGREE_ANGLE;
            }

            angleOfRotation |= 0;

            var skyWidth  = _sky.width;
            var skyHeight = _sky.height;

            if (angleOfRotation + 320 <= skyWidth) {
                _framebuffer.drawImage(_sky, angleOfRotation, 0, 320,
                    skyHeight, 0, 0, 320, skyHeight);
            } else {
                _framebuffer.drawImage(_sky, angleOfRotation, 0,
                    skyWidth - angleOfRotation, skyHeight, 0, 0,
                    skyWidth - angleOfRotation, skyHeight);
                _framebuffer.drawImage(_sky, 0, 0,
                    320 - (skyWidth - angleOfRotation),
                    skyHeight, skyWidth - angleOfRotation, 0,
                    320 - (skyWidth - angleOfRotation), skyHeight);
            }
        };

        /**
         * Render the terrain (landscape).
         */
        var _renderTerrain = function() {
            _framebuffer.fillStyle = '#7f7f7f';
            _framebuffer.fillRect(0, 100, 320, 25);

            var initialAngle = _camera.angle - _THIRTY_DEGREE_ANGLE;

            if (initialAngle < 0) {
                initialAngle += _THREE_HUNDRED_AND_SIXTY_DEGREE_ANGLE;
            }

            initialAngle |= 0;

            var currentAngle = initialAngle;

            for (var ray = _quality; ray < 320; ray += _quality) {
                var previousTop = 200 + 100 - 1;

                for (var row = 200 + 100 - 1; row >= 50; --row) {
                    var rayLength = _rayLengthLookupTable[
                        (row << 8) + (row << 6) + ray];

                    var rayX = _camera.x + rayLength *
                        _cosineLookupTable[currentAngle] | 0;
                    var rayZ = _camera.z + rayLength *
                        _sineLookupTable[currentAngle] | 0;

                    var u = rayX & 1023;
                    var v = rayZ & 1023;

                    var height;
                    if ((rayX < 1024 || rayX > 1024 + 1024 ||
                        rayZ < 1024 || rayZ > 1024 + 1024) &&
                        _outOfBoundsHeightmap.length > 0) {
                        height = _outOfBoundsHeightmap[(v << 10) + u];
                    } else {
                        height = _heightmap[(v << 10) + u];
                    }

                    var scale = height * _SCALE_FACTOR /
                        (rayLength + 1) | 0;

                    var top = 50 + row - scale,
                        bottom = top + scale;

                    if (top < previousTop) {
                        bottom = previousTop;
                        previousTop = top;

                        var color = '';

                        if (rayX < 1024 || rayX > 1024 + 1024 ||
                            rayZ < 1024 || rayZ > 1024 + 1024) {
                            var texel = _getPixelFromOutOfBoundsTexturemap(
                                u, v);

                            if (_fog) {
                                var foggedTexel = _alphaBlend(texel,
                                    { red: 127, green: 127, blue: 127 },
                                    ~~(row / 150 * 255));

                                texel = foggedTexel;
                            }

                            color = 'rgb(' + texel.red +
                                ', ' + texel.green + ', ' +
                                texel.blue + ')';
                        } else {
                            if (height < _waterHeight) {
                                var data = _getPixelFromSky(ray,
                                    200 - top);

                                var texel = _getPixelFromTexturemap(u, v);

                                var mixedColor = _alphaBlend(data,
                                    texel, ~~((_waterHeight - height) /
                                    _waterHeight * 255 * 2));

                                texel = mixedColor;

                                if (_fog) {
                                    var foggedTexel = _alphaBlend(
                                        mixedColor,
                                        { red: 127, green: 127, blue: 127 },
                                        ~~(row / 100 * 255));

                                    texel = foggedTexel;
                                }

                                height = _waterHeight;

                                color = 'rgb(' + texel.red + ', ' +
                                    texel.green + ', ' +
                                    texel.blue + ')';
                            } else {
                                var texel = _getPixelFromTexturemap(u, v);

                                if (_fog) {
                                    var foggedTexel = _alphaBlend(texel,
                                        { red: 127, green: 127, blue: 127 },
                                        ~~(row / 150 * 255));

                                    texel = foggedTexel;
                                }

                                color = 'rgb(' + texel.red +
                                    ', ' + texel.green + ', ' +
                                    texel.blue + ')';
                            }
                        }

                        // Render sliver...
                        if (bottom > 199) {
                            bottom = 199;
                        }

                        _framebuffer.fillStyle = color;
                        if (ray > _quality) {
                            // Not the left-most ray...
                            _framebuffer.fillRect(ray, top - _smooth,
                                _quality, bottom - top + 1);
                        } else {
                            // Left-most ray: we don't cast rays for
                            // column 0!
                            _framebuffer.fillRect(0, top - _smooth,
                                _quality << 1, bottom - top + 1);
                        }
                    }
                }

                currentAngle += _quality;
                if (currentAngle >=
                    _THREE_HUNDRED_AND_SIXTY_DEGREE_ANGLE) {
                    currentAngle = 0;
                }
            }
        };

        /**
         * Render the terrain (landscape) with sprites.
         */
        var _renderTerrainWithSprites = function() {
            /*
             * 1. Construct a list of visible sprites; sprites are visible
             *    where they fall within the -30..30 (60-degree) horizontal
             *    field-of-view based on the direction that the camera is
             *    pointing in.
             * 2. For each visible sprite, determine its projected 2D coords
             *    (x and y) and its scaled width and height based on distance
             *    from the camera. The y coord corresponds to the bottom of the
             *    sprite and the x coord is the centre of the width of the
             *    sprite.
             * 3. After drawing each row of terrain, draw any sprites where the
             *    sprite's y coord equals the current row (THIS NEEDS
             *    REVISING). Remove the sprite from the list of visible
             *    sprites.
             * 4. Rinse and repeat.
             */

            // Fill the upper region of the framebuffer with the fog-colour.
            _framebuffer.fillStyle = '#7f7f7f';
            _framebuffer.fillRect(0, 100, 320, 25);

            // Empty the list of visible sprites.
            _visibleSpriteList.length = 0;

            // Calculate the unit vector of the camera.
            var cameraVectorX = Math.cos(_camera.angle * _ANGULAR_INCREMENT *
                _DEGREES_TO_RADIANS);
            var cameraVectorZ = Math.sin(_camera.angle * _ANGULAR_INCREMENT *
                _DEGREES_TO_RADIANS);

            // Calculate the magnitude of the camera's unit vector; being a
            // unit vector, the magnitude should equal 1.
            var cameraMagnitude = Math.sqrt(
                cameraVectorX * cameraVectorX +
                cameraVectorZ * cameraVectorZ);

            console.log('cameraVectorX = ' + cameraVectorX);
            console.log('cameraVectorZ = ' + cameraVectorZ);
            console.log('cameraMagnitude = ' + cameraMagnitude);

            // For each sprite...
            for (var i = 0; i < _spriteList.length; ++i) {
                var sprite = _spriteList[i];

                // Calculate the vector of the sprite.
                var spriteVectorX = sprite.x - _camera.x;
                var spriteVectorZ = sprite.z - _camera.z;

                // Calculate the magnitude (length of the vector) to determine
                // the distance from the camera to the sprite.
                var vectorLength = Math.sqrt(
                    spriteVectorX * spriteVectorX +
                    spriteVectorZ * spriteVectorZ);

                console.log('vectorLength (distance from the camera to the ' +
                    'sprite) = ' + vectorLength);

                // Normalise the sprite vector to become the unit vector.
                spriteVectorX /= vectorLength;
                spriteVectorZ /= vectorLength;

                // Calculate the magnitude of the sprite's unit vector; being a
                // unit vector, the magnitude should equal 1.
                var spriteMagnitude = Math.sqrt(
                    spriteVectorX * spriteVectorX +
                    spriteVectorZ * spriteVectorZ);

                console.log('spriteVectorX = ' + spriteVectorX);
                console.log('spriteVectorZ = ' + spriteVectorZ);
                console.log('spriteMagnitude = ' + spriteMagnitude);

                // Calculate the dot product of the camera and sprite vectors.
                var dotProduct = cameraVectorX * spriteVectorX +
                    cameraVectorZ * spriteVectorZ;

                console.log('dotProduct = ' + dotProduct);

                // If the dot product is negative...
                if (dotProduct < 0) {
                    // The sprite is behind the camera, so clearly not in view.
                    // Move to the next sprite.
                    continue;
                }

                // Calculate the angle (theta) between the camera vector and
                // the sprite vector.
                var theta = Math.acos(dotProduct /
                    (cameraMagnitude * spriteMagnitude));

                console.log('theta = ' + theta);

                // Convert theta from radians to degrees (for debugging
                // purposes only).
                var thetaInDegrees = Math.round(theta * _RADIANS_TO_DEGREES);

                console.log('thetaInDegrees = ' + thetaInDegrees);

                // If the angle (theta) is less than or equal to 30 degrees...
                // NOTE: We do NOT need to check the lower bound (-30 degrees)
                // because theta will /never/ be negative.
                if (theta <= _THIRTY_DEGREE_ANGLE * _FAKE_DEGREES_TO_RADIANS) {
                    var scale = 1 / (vectorLength + 1) * _SCALE_FACTOR;

                    var width  = scale * sprite.image.width  | 0;
                    var height = scale * sprite.image.height | 0;

                    // Calculate the projected x coord relative to the
                    // horizonal centre of the canvas.
                    var x = Math.round(theta * _RADIANS_TO_FAKE_DEGREES -
                        width / 2);
                    // Add or subtract the value of x from the horizontal
                    // centre of the canvas.
                    // NOTE: This will NOT work as the dot product is always
                    // positive where the angle (theta) is acute, which it will
                    // be cos' theta is less than or equal to 30 degrees!!!
                    if (dotProduct < 0) {
                        x = _CANVAS_WIDTH / 2 - x;
                    } else {
                        x = _CANVAS_WIDTH / 2 + x;
                    }

                    // Add the projected sprite to the list of visible sprites.
                    // NOTE: Thus far, only the scaled width and height,
                    // vectorLength and image are guaranteed to be correct.
                    _visibleSpriteList.push({
                        height:       height,
                        image:        sprite.image,
                        row:          50 + sprite.y * (_DISTANCE / (spriteVectorZ * vectorLength)) | 0,
                        vectorLength: vectorLength,
                        width:        width,
                        x:            x,
//                        y:            sprite.y * (_DISTANCE / (sprite.z - _camera.z)) - (scale * sprite.y + height) | 0
//                        y:            scale * sprite.y + height | 0
//                        y:            scale * (sprite.y + sprite.image.height) | 0
                        y:            (_CANVAS_WIDTH - width) / 2 | 0
                    });
                }
            }

            var initialAngle = _camera.angle - _THIRTY_DEGREE_ANGLE;

            if (initialAngle < 0) {
                initialAngle += _THREE_HUNDRED_AND_SIXTY_DEGREE_ANGLE;
            }

            initialAngle |= 0;

            var currentAngle = initialAngle;

            for (var row = 50; row < 200 + 100 - 1; ++row) {

                for (var ray = _quality; ray < 320; ray += _quality) {
                    var rayLength = _rayLengthLookupTable[
                        (row << 8) + (row << 6) + ray];

                    var rayX = _camera.x + rayLength *
                        _cosineLookupTable[currentAngle] | 0;
                    var rayZ = _camera.z + rayLength *
                        _sineLookupTable[currentAngle] | 0;

                    var u = rayX & 1023;
                    var v = rayZ & 1023;

                    var height;
                    if ((rayX < 1024 || rayX > 1024 + 1024 ||
                        rayZ < 1024 || rayZ > 1024 + 1024) &&
                        _outOfBoundsHeightmap.length > 0) {
                        height = _outOfBoundsHeightmap[(v << 10) + u];
                    } else {
                        height = _heightmap[(v << 10) + u];
                    }

                    var scale = height * _SCALE_FACTOR /
                        (rayLength + 1) | 0;

                    var top = 50 + row - scale,
                        bottom = top + scale;

                    var color = '';

                    if (rayX < 1024 || rayX > 1024 + 1024 ||
                        rayZ < 1024 || rayZ > 1024 + 1024) {
                        var texel = _getPixelFromOutOfBoundsTexturemap(
                            u, v);

                        if (_fog) {
                            var foggedTexel = _alphaBlend(texel,
                                { red: 127, green: 127, blue: 127 },
                                ~~(row / 150 * 255));

                            texel = foggedTexel;
                        }

                        color = 'rgb(' + texel.red +
                            ', ' + texel.green + ', ' +
                            texel.blue + ')';
                    } else {
                        if (height < _waterHeight) {
                            var data = _getPixelFromSky(ray,
                                200 - top);

                            var texel = _getPixelFromTexturemap(u, v);

                            var mixedColor = _alphaBlend(data,
                                texel, ~~((_waterHeight - height) /
                                _waterHeight * 255 * 2));

                            texel = mixedColor;

                            if (_fog) {
                                var foggedTexel = _alphaBlend(
                                    mixedColor,
                                    { red: 127, green: 127, blue: 127 },
                                    ~~(row / 100 * 255));

                                texel = foggedTexel;
                            }

                            height = _waterHeight;

                            color = 'rgb(' + texel.red + ', ' +
                                texel.green + ', ' +
                                texel.blue + ')';
                        } else {
                            var texel = _getPixelFromTexturemap(u, v);

                            if (_fog) {
                                var foggedTexel = _alphaBlend(texel,
                                    { red: 127, green: 127, blue: 127 },
                                    ~~(row / 150 * 255));

                                texel = foggedTexel;
                            }

                            color = 'rgb(' + texel.red +
                                ', ' + texel.green + ', ' +
                                texel.blue + ')';
                        }
                    }

                    // Render sliver...
                    if (bottom > 199) {
                        bottom = 199;
                    }

                    _framebuffer.fillStyle = color;
                    if (ray > _quality) {
                        // Not the left-most ray...
                        _framebuffer.fillRect(ray, top - _smooth,
                            _quality, bottom - top + 1);
                    } else {
                        // Left-most ray: we don't cast rays for
                        // column 0!
                        _framebuffer.fillRect(0, top - _smooth,
                            _quality << 1, bottom - top + 1);
                    }

                    currentAngle += _quality;
                    if (currentAngle >=
                        _THREE_HUNDRED_AND_SIXTY_DEGREE_ANGLE) {
                        currentAngle = 0;
                    }
                }

                for (var i = 0; i < _visibleSpriteList.length; ++i) {
                    if (_visibleSpriteList[i] === undefined) {
                        continue;
                    }

                    var sprite = _visibleSpriteList[i];

                    if (row == sprite.row) {
                        console.log('height = ' + sprite.height);
                        console.log('row = ' + sprite.row);
                        console.log('vectorLength = ' + sprite.vectorLength);
                        console.log('width = ' + sprite.width);
                        console.log('x = ' + sprite.x);
                        console.log('y = ' + sprite.y);

//                        var newY = row + sprite.height - sprite.y;
                        var newY = sprite.y;

                        console.log('newY = ' + newY);

                        _framebuffer.drawImage(
                            sprite.image,
                            sprite.x,
                            newY,
                            sprite.width,
                            sprite.height);
                        _visibleSpriteList[i] = undefined;
                    }
                }

                currentAngle = initialAngle;
            }
        };

        if (canvas.width !== _CANVAS_WIDTH) {
            throw('Canvas width not equal to ' + _CANVAS_WIDTH);
        }
        if (canvas.height !== _CANVAS_HEIGHT) {
            throw('Canvas height not equal to ' + _CANVAS_HEIGHT);
        }

        _framebuffer = canvas.getContext('2d');

        _initSineAndCosineLookupTables();
        _initInverseDistortionLookupTable();
        _initRayLengthLookupTable(_CAMERA_Y, _DISTANCE);

        return {
            /**
             * ...
             *
             * @param {Image} image ...
             * @param {number} x ...
             * @param {number} z ...
             * @return {Renderer} This (fluent interface).
             */
            addSprite: function(image, x, z) {
                var u = x & 1023;
                var v = z & 1023;

                _spriteList.push({
                    image: image,
                    x: x,
                    y: _heightmap[(v << 10) + u],
                    z: z
                });
            },

            /**
             * Disable a Steppe capability.
             *
             * @param {string} capability Specifies a string indicating a
             *                            Steppe capability; 'fog',
             *                            'reflection-map' and 'smooth' are
             *                            currently implemented.
             * @return {Renderer} This (fluent interface).
             */
            disable: function(capability) {
                if (capability === 'fog') {
                    _fog = false;
                } else if (capability === 'reflection-map') {
                    _waterHeight = -1;
                } else if (capability === 'smooth') {
                    _smooth = 0;
                } else {
                    throw("Can't disable unknown capability");
                }

                return this;
            },

            /**
             * Enable a Steppe capability.
             *
             * @param {string} capability Specifies a string indicating a
             *                            Steppe capability; 'fog',
             *                            'reflection-map' and 'smooth' are
             *                            currently implemented.
             * @return {Renderer} This (fluent interface).
             */
            enable: function(capability) {
                if (capability === 'fog') {
                    _fog = true;
                } else if (capability === 'reflection-map') {
                    _waterHeight = _WATER_HEIGHT;
                } else if (capability === 'smooth') {
                    _smooth = 0.5;
                } else {
                    throw("Can't enable unknown capability");
                }

                return this;
            },

            /**
             * Get the current camera.
             *
             * @return {object} ...
             */
            getCamera: function() {
                return {
                    angle: _camera.angle /
                        _THREE_HUNDRED_AND_SIXTY_DEGREE_ANGLE * 360 +
                        0.5 | 0,
                    x:     _camera.x,
                    y:     _camera.y,
                    z:     _camera.z
                };
            },

            /**
             * ...
             *
             * @param {number} x ...
             * @param {number} z ...
             * @return {number} ...
             */
            getHeight: function(x, z) {
                var u = x & 1023;
                var v = z & 1023;

                return _heightmap[(v << 10) + u];
            },

            /**
             * Test whether a capability is enabled.
             *
             * @param {string} capability Specifies a string indicating a
             *                            Steppe capability; 'smooth' and
             *                            'reflection-map' are currently
             *                            implemented.
             * @return {boolean} Returns true if capability is an enabled
             *                   capability and returns false otherwise.
             */
            isEnabled: function(capability) {
                if (capability === 'fog') {
                    return _fog;
                } else if (capability === 'reflection-map') {
                    return (_waterHeight > -1);
                } else if (capability === 'smooth') {
                    return (_smooth === 0.5);
                }
                throw('Unknown capability');
            },

            /**
             * Render the terrain (landscape) including the sky.
             */
            render: function() {
                _renderSky();
                if (_spriteList.length > 0) {
                    _renderTerrainWithSprites();
                } else {
                    _renderTerrain();
                }
            },

            /**
             * Set the current camera.
             *
             * @param {object} camera ...
             * @return {Renderer} This (fluent interface).
             */
            setCamera: function(camera) {
                if (typeof(camera) != 'object') {
                    throw('Invalid camera: not an object');
                }

                _camera.angle = (camera.angle !== undefined &&
                    typeof(camera.angle) == 'number') ?
                    (Math.abs(~~(camera.angle + 0.5)) % 360 /
                    _ANGLE_OF_VIEW * 320) :
                    (_camera.angle);
                _camera.x = (camera.x !== undefined &&
                    typeof(camera.x) == 'number') ?
                    (~~(camera.x + 0.5)) : (_camera.x);

                if (camera.y !== undefined &&
                    typeof(camera.y) == 'number') {
                    _camera.y = ~~(camera.y + 0.5);
                    _initRayLengthLookupTable(_camera.y, _DISTANCE);
                }

                _camera.z = (camera.z !== undefined &&
                    typeof(camera.z) == 'number') ?
                    (~~(camera.z + 0.5)) : (_camera.z);

                return this;
            },

            /**
             * Set the heightmap to use for terrain rendering.
             *
             * @param {array} heightmap The heightmap canvas as an array of
             *                          values in the range 0..255.
             * @return {Renderer} This (fluent interface).
             */
            setHeightmap: function(heightmap) {
                _heightmap = heightmap;

                return this;
            },

            /**
             * ...
             *
             * @param {array} outOfBoundsHeightmap ...
             * @return {Renderer} This (fluent interface).
             */
            setOutOfBoundsHeightmap: function(outOfBoundsHeightmap) {
                _outOfBoundsHeightmap = outOfBoundsHeightmap;

                return this;
            },

            /**
             * ...
             *
             * @param {HTMLCanvasElement} outOfBoundsTexturemapCanvas ...
             * @return {Renderer} This (fluent interface).
             */
            setOutOfBoundsTexturemap: function(
                outOfBoundsTexturemapCanvas) {
                if ( !(outOfBoundsTexturemapCanvas instanceof
                    HTMLCanvasElement)) {
                    throw('Invalid outOfBoundsTexturemapCanvas: not an ' +
                        'instance of HTMLCanvasElement');
                }

                if (outOfBoundsTexturemapCanvas.width != 1024) {
                    throw('outOfBoundsTexturemapCanvas width not equal ' +
                        'to 1024');
                }
                if (outOfBoundsTexturemapCanvas.height != 1024) {
                    throw('outOfBoundsTexturemapCanvas height not equal ' +
                        'to 1024');
                }

                _outOfBoundsTexturemap =
                    outOfBoundsTexturemapCanvas.getContext('2d')
                    .getImageData(0, 0, outOfBoundsTexturemapCanvas.width,
                    outOfBoundsTexturemapCanvas.height).data;

                return this;
            },

            /**
             * Set render quality.
             *
             * @param {string} quality Specifies a string indicating the
             *                         render quality from 'low', through
             *                         'medium', to 'high'.
             * @return {Renderer} This (fluent interface).
             */
            setQuality: function(quality) {
                if (quality === 'medium') {
                    _quality = _DONT_CARE;
                } else if (quality === 'low') {
                    _quality = _FASTEST;
                } else if (quality === 'high') {
                    _quality = _NICEST;
                } else {
                    throw("Invalid quality; must be 'low', 'medium', " +
                        "or 'high'");
                }

                return this;
            },

            /**
             * Set the canvas to use for 360-degree panoramic sky.
             *
             * @param {HTMLCanvasElement} skyCanvas The sky canvas; must be
             *                                      1920x100.
             */
            setSky: function(skyCanvas) {
                if ( !(skyCanvas instanceof HTMLCanvasElement)) {
                    throw('Invalid skyCanvas: not an instance of ' +
                        'HTMLCanvasElement');
                }

                if (skyCanvas.width != 1920) {
                    throw('skyCanvas width not equal to 1920');
                }
                if (skyCanvas.height != 100) {
                    throw('skyCanvas height not equal to 100');
                }

                _sky = skyCanvas;

                return this;
            },

            /**
             * ...
             *
             * @param {HTMLCanvasElement} texturemapCanvas ...
             * @return {Renderer} This (fluent interface).
             */
            setTexturemap: function(texturemapCanvas) {
                if ( !(texturemapCanvas instanceof HTMLCanvasElement)) {
                    throw('Invalid texturemapCanvas: not an instance of ' +
                        'HTMLCanvasElement');
                }

                if (texturemapCanvas.width != 1024) {
                    throw('texturemapCanvas width not equal to 1024');
                }
                if (texturemapCanvas.height != 1024) {
                    throw('texturemapCanvas height not equal to 1024');
                }

                _texturemap = texturemapCanvas.getContext('2d')
                    .getImageData(0, 0, texturemapCanvas.width,
                    texturemapCanvas.height).data;

                return this;
            },

            /**
             * Set height of the reflection-mapped water.
             *
             * @param {number} height Globally-defined height of the
             *                        reflection-mapped water. It must be
             *                        in the range 0..255.
             * @return {Renderer} This (fluent interface).
             */
            setWaterHeight: function(height) {
                if (_waterHeight == -1) {
                    throw('Capability not enabled');
                }

                if (typeof(height) != 'number') {
                    throw('Invalid height: not a number');
                }

                if (height < 0 || height > 255) {
                    throw('Invalid height: must be in the range 0..255');
                }

                _waterHeight = height;

                return this;
            }
        };
    };

    return Steppe;
} (Steppe || { }) );
