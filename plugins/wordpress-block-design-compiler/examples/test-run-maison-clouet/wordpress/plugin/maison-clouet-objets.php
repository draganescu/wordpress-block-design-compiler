<?php
/**
 * Plugin Name: Maison Clouet Objets
 * Description: Registers the objet custom post type, category taxonomy, object metadata, REST support, and sample Maison Clouet inventory.
 * Version: 0.1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'init', 'maison_clouet_register_objets' );
add_action( 'init', 'maison_clouet_register_objet_meta' );
register_activation_hook( __FILE__, 'maison_clouet_seed_objets' );

function maison_clouet_register_objets() {
	register_post_type(
		'objet',
		array(
			'labels'       => array(
				'name'          => __( 'Objets', 'maison-clouet' ),
				'singular_name' => __( 'Objet', 'maison-clouet' ),
			),
			'public'       => true,
			'show_in_rest' => true,
			'menu_icon'    => 'dashicons-art',
			'supports'     => array( 'title', 'editor', 'thumbnail', 'excerpt', 'custom-fields' ),
			'has_archive'  => true,
			'rewrite'      => array( 'slug' => 'objets' ),
		)
	);

	register_taxonomy(
		'objet_category',
		'objet',
		array(
			'labels'       => array(
				'name'          => __( 'Objet categories', 'maison-clouet' ),
				'singular_name' => __( 'Objet category', 'maison-clouet' ),
			),
			'public'       => true,
			'show_in_rest' => true,
			'hierarchical' => true,
			'rewrite'      => array( 'slug' => 'objet-category' ),
		)
	);
}

function maison_clouet_register_objet_meta() {
	$fields = array(
		'price_eur'  => 'string',
		'dimensions' => 'string',
		'condition'  => 'string',
		'story'      => 'string',
		'images'     => 'array',
	);

	foreach ( $fields as $key => $type ) {
		register_post_meta(
			'objet',
			$key,
			array(
				'type'              => $type,
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'maison_clouet_sanitize_meta',
				'auth_callback'     => function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}
}

function maison_clouet_sanitize_meta( $value ) {
	if ( is_array( $value ) ) {
		return array_map( 'esc_url_raw', $value );
	}

	return sanitize_text_field( $value );
}

function maison_clouet_seed_objets() {
	maison_clouet_register_objets();

	$objects = array(
		array( 'title' => '1960s opaline glass vase', 'price' => '€120', 'category' => 'glass', 'dimensions' => '28 x 12 cm', 'condition' => 'excellent, one tiny flea bite', 'story' => 'Found at a house clearance near Apt, wrapped in a pharmacy calendar from 1971.' ),
		array( 'title' => 'Indigo-dyed linen napkins from Arles', 'price' => '€68', 'category' => 'textiles', 'dimensions' => 'set of 6, 42 x 42 cm', 'condition' => 'washed, softened, irregular dye', 'story' => 'Bought from a market table between tomato seedlings and opera records.' ),
		array( 'title' => 'Brass library lamp', 'price' => '€240', 'category' => 'lighting', 'dimensions' => '41 cm high', 'condition' => 'rewired, patina intact', 'story' => 'Heavy shade, green felt base, from a retired notaire desk outside Cavaillon.' ),
		array( 'title' => 'Ochre ceramic confit bowl', 'price' => '€890', 'category' => 'ceramics', 'dimensions' => '46 cm diameter', 'condition' => 'stable hairline, beautiful wear', 'story' => 'A serious bowl from a farmhouse kitchen where everything smelled faintly of thyme.' ),
		array( 'title' => 'Small wall mirror with blue edge', 'price' => '€145', 'category' => 'wall art', 'dimensions' => '33 x 24 cm', 'condition' => 'foxed glass, original backing', 'story' => 'Found behind a bookcase in L Isle-sur-la-Sorgue, exactly where it wanted to be.' ),
		array( 'title' => 'Fig leaf room spray', 'price' => '€38', 'category' => 'scent', 'dimensions' => '100 ml', 'condition' => 'made to order', 'story' => 'Green fig, stone dust, and the first opened shutter after Sunday market.' )
	);

	foreach ( $objects as $object ) {
		if ( get_page_by_title( $object['title'], OBJECT, 'objet' ) ) {
			continue;
		}

		$post_id = wp_insert_post(
			array(
				'post_type'    => 'objet',
				'post_status'  => 'publish',
				'post_title'   => $object['title'],
				'post_content' => $object['story'],
			)
		);

		if ( is_wp_error( $post_id ) ) {
			continue;
		}

		wp_set_object_terms( $post_id, $object['category'], 'objet_category' );
		update_post_meta( $post_id, 'price_eur', $object['price'] );
		update_post_meta( $post_id, 'dimensions', $object['dimensions'] );
		update_post_meta( $post_id, 'condition', $object['condition'] );
		update_post_meta( $post_id, 'story', $object['story'] );
		update_post_meta( $post_id, 'images', array() );
	}
}
