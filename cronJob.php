<?php
    $connect = mysqli_connect("localhost", $_ENV['DB_USER'], $_ENV['DB_PWD'], $_ENV['DB_NAME']);
    
    require dirname(__DIR__).'/phpComposer/twilio/vendor/autoload.php';
    require dirname(__DIR__).'/phpComposer/dotEnv/vendor/autoload.php';
    
    $dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
    $dotenv->load();
    
    use Twilio\Rest\Client;
    
    $sid    = $_ENV['TWIIO_SID'];
    $token  = $_ENV['TWILIO_TOKEN'];
    $twilio = new Client($sid, $token);
    
    echo $twilio;
    
    $search_query = "SELECT * from nylas";
    $result_search_query = mysqli_query($connect, $search_query) or die(mysqli_error($connect));
    
    echo mysqli_num_rows($result_search_query)."<br><br>";
    
    while($row = mysqli_fetch_array($result_search_query)) {
        print_r($row['message']."<br>");
        print_r($row['dob']."<br><br>");
        
        $currDate = date('Y-m-d');
        echo "Current date is: ".$currDate."<br>";
        
        $dob = date_create($row['dob'])->format(date("Y")."-m-d");
        
        echo "Contact birthday date is: ".$dob."<br>";
        $diff = date_diff(date_create($currDate),date_create($dob))->format("%R%a");
        
        // diff will be positive when the birthdate will exceed the current date
        // so, when the diff will be 0, that means this is the contact's birthday
        echo "Difference is: ".$diff."<br><br>";
        
        if($diff == 0 && !$row['sent']) {
            echo "Sending the SMS";
            $message = $twilio->messages
              ->create($row['contactPhone'], // to
                array(
                  "from" => $_ENV['TWILIO_PHONE'],
                  "body" => $row['message']
                )
              );
              
            // updating the database:
            $update_query = "UPDATE nylas SET sent = true WHERE contactName = '$row[contactName]' && dob = '$row[dob]' && message = '$row[message]'";
            $query_result = mysqli_query($connect, $update_query) or die(mysqli_error($connect));
        }
        
        // as the contact has been wished, time to reomove the automation from the db
        if($diff < 0) {
            echo "Deleting the contact: ".$row['contactName']." whose birthday was on: ".$dob;
            $delete_query = "DELETE FROM nylas WHERE contactName = '$row[contactName]' && dob = '$row[dob]' && message = '$row[message]'";
            $query_result = mysqli_query($connect, $delete_query) or die(mysqli_error($connect));  
        }
    }
?>